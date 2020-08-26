import '../../../setup'

/* External Imports */
import { ethers } from '@nomiclabs/buidler'
import {
  getLogger,
  ZERO_ADDRESS,
  NULL_ADDRESS,
  hexStrToNumber,
  numberToHexString,
} from '@eth-optimism/core-utils'
import { Contract, ContractFactory, Signer } from 'ethers'

/* Internal Imports */
import {
  GAS_LIMIT,
  Address,
  manuallyDeployOvmContract,
  makeAddressResolver,
  deployAndRegister,
  AddressResolverMapping,
  executeTransaction,
} from '../../../test-helpers'

/* Logging */
const log = getLogger('execution-manager-calls', true)

/* Testing Constants */

const OVM_TX_BASE_GAS_FEE = 30_000
const OVM_TX_MAX_GAS = 2_000_000
const GAS_RATE_LIMIT_EPOCH_IN_SECONDS = 60_000
const MAX_GAS_PER_EPOCH = 2_000_000

const SEQUENCER_ORIGIN = 0
const QUEUED_ORIGIN = 1

const INITIAL_OVM_DEPLOY_TIMESTAMP = 1

const abi = new ethers.utils.AbiCoder()

// Empirically determined constant which is some extra gas the EM records due to running CALL, gasAfter - gasBefore, etc.
// This is unfortunately not always the same--it will differ based on the size of calldata into the CALL.
// However, that size is constant for these tests, since we only call consumeGas() below.
const CONSUME_GAS_EXECUTION_OVERHEAD = 39945

/*********
 * TESTS *
 *********/

describe('Execution Manager -- Gas Metering', () => {
  const provider = ethers.provider

  let wallet: Signer
  let walletAddress: string
  let resolver: AddressResolverMapping
  let GasConsumer: ContractFactory
  let ExecutionManager: ContractFactory
  let StateManager: ContractFactory
  let StateManagerGasSanitizer: ContractFactory
  let stateManagerGasSanitizer: Contract

  let executionManager: Contract
  let gasConsumerAddress: Address
  before(async () => {
    ;[wallet] = await ethers.getSigners()
    walletAddress = await wallet.getAddress()
    resolver = await makeAddressResolver(wallet)
    GasConsumer = await ethers.getContractFactory('GasConsumer')
    ExecutionManager = await ethers.getContractFactory('ExecutionManager')
    StateManager = await ethers.getContractFactory('FullStateManager')
    StateManagerGasSanitizer = await ethers.getContractFactory(
      'StateManagerGasSanitizer'
    )

    // redeploy EM with our gas metering params
    executionManager = await deployAndRegister(
      resolver.addressResolver,
      wallet,
      'ExecutionManager',
      {
        factory: ExecutionManager,
        params: [
          resolver.addressResolver.address,
          NULL_ADDRESS,
          [
            OVM_TX_BASE_GAS_FEE,
            OVM_TX_MAX_GAS,
            GAS_RATE_LIMIT_EPOCH_IN_SECONDS,
            MAX_GAS_PER_EPOCH,
            MAX_GAS_PER_EPOCH,
          ],
        ],
      }
    )
  })

  beforeEach(async () => {
    stateManagerGasSanitizer = await deployAndRegister(
      resolver.addressResolver,
      wallet,
      'StateManagerGasSanitizer',
      {
        factory: StateManagerGasSanitizer,
        params: [resolver.addressResolver.address],
      }
    )

    await deployAndRegister(resolver.addressResolver, wallet, 'StateManager', {
      factory: StateManager,
      params: [],
    })

    gasConsumerAddress = await manuallyDeployOvmContract(
      wallet,
      provider,
      executionManager,
      GasConsumer,
      [],
      INITIAL_OVM_DEPLOY_TIMESTAMP
    )
  })

  const assertOvmTxRevertedWithMessage = async (
    tx: any,
    msg: string,
    _wallet: any
  ) => {
    const reciept = await _wallet.provider.getTransactionReceipt(tx.hash)
    const revertTopic = ethers.utils.id('EOACallRevert(bytes)')
    const revertEvent = reciept.logs.find((logged) => {
      return logged.topics.includes(revertTopic)
    })
    revertEvent.should.not.equal(undefined)
    revertEvent.data.should.equal(abi.encode(['bytes'], [Buffer.from(msg)]))
    return
  }

  const assertOvmTxDidNotRevert = async (tx: any, _wallet: any) => {
    const reciept = await _wallet.provider.getTransactionReceipt(tx.hash)
    const revertTopic = ethers.utils.id('EOACallRevert(bytes)')
    const revertEvent = reciept.logs.find((logged) => {
      return logged.topics.includes(revertTopic)
    })
    const didNotRevert: boolean = !revertEvent
    const msg = didNotRevert
      ? ''
      : `Expected not to find an EOACallRevert but one was found with data: ${revertEvent.data}`
    didNotRevert.should.eq(true, msg)
  }

  const getConsumeGasCallback = (
    timestamp: number,
    queueOrigin: number,
    gasToConsume: number,
    gasLimit: any = false,
    blockNumber: number = 0
  ) => {
    const internalCallBytes = GasConsumer.interface.encodeFunctionData(
      'consumeGasInternalCall',
      [gasToConsume]
    )

    // overall tx gas padding to account for executeTransaction and SimpleGas return overhead
    const gasLimitPad: number = 500_000
    const ovmTxGasLimit: number = gasLimit
      ? gasLimit
      : gasToConsume + OVM_TX_BASE_GAS_FEE + gasLimitPad

    const EMCallBytes = ExecutionManager.interface.encodeFunctionData(
      'executeTransaction',
      [
        timestamp,
        blockNumber,
        queueOrigin,
        gasConsumerAddress,
        internalCallBytes,
        walletAddress,
        ZERO_ADDRESS,
        ovmTxGasLimit,
        false,
      ]
    )

    return async () => {
      return wallet.sendTransaction({
        to: executionManager.address,
        data: EMCallBytes,
        gasLimit: GAS_LIMIT,
      })
    }
  }

  const getCumulativeQueuedGas = async (): Promise<number> => {
    const data: string = executionManager.interface.encodeFunctionData(
      'getCumulativeQueuedGas',
      []
    )
    const res = await executionManager.provider.call({
      to: executionManager.address,
      data,
    })
    return hexStrToNumber(res)
  }

  const getCumulativeSequencedGas = async (): Promise<number> => {
    const data: string = executionManager.interface.encodeFunctionData(
      'getCumulativeSequencedGas',
      []
    )
    const res = await executionManager.provider.call({
      to: executionManager.address,
      data,
    })
    return hexStrToNumber(res)
  }

  const getChangeInCumulativeGas = async (
    callbackConsumingGas: () => Promise<any>
  ): Promise<{ sequenced: number; queued: number }> => {
    // record value before
    const queuedBefore: number = await getCumulativeQueuedGas()
    const sequencedBefore: number = await getCumulativeSequencedGas()
    log.debug(
      `calling the callback which should change gas, before is: ${queuedBefore}, ${sequencedBefore}`
    )
    await callbackConsumingGas()
    log.debug(`finished calling the callback which should change gas`)
    const queuedAfter: number = await getCumulativeQueuedGas()
    const sequencedAfter: number = await getCumulativeSequencedGas()
    log.debug(`values after callback are: ${queuedAfter}, ${sequencedAfter}`)
    return {
      sequenced: sequencedAfter - sequencedBefore,
      queued: queuedAfter - queuedBefore,
    }
  }

  describe('Per-transaction gas limit requirements', async () => {
    const timestamp = 1
    it('Should revert ovm TX if the gas limit is higher than the max allowed', async () => {
      const gasToConsume = OVM_TX_MAX_GAS + 1
      const doTx = getConsumeGasCallback(
        timestamp,
        SEQUENCER_ORIGIN,
        gasToConsume
      )
      await assertOvmTxRevertedWithMessage(
        await doTx(),
        'Transaction gas limit exceeds max OVM tx gas limit.',
        wallet
      )
    })
    it('Should revert ovm TX if the gas limit is lower than the base gas fee', async () => {
      const gasToConsume = OVM_TX_BASE_GAS_FEE
      const doTx = getConsumeGasCallback(
        timestamp,
        SEQUENCER_ORIGIN,
        gasToConsume,
        OVM_TX_BASE_GAS_FEE - 1
      )
      await assertOvmTxRevertedWithMessage(
        await doTx(),
        'Transaction gas limit is less than the minimum (base fee) gas.',
        wallet
      )
    })
  })
  describe('Cumulative gas tracking', async () => {
    const timestamp = 1
    it('Should properly track sequenced consumed gas', async () => {
      const gasToConsume: number = 500_000
      const consumeTx = getConsumeGasCallback(
        timestamp,
        SEQUENCER_ORIGIN,
        gasToConsume
      )
      const change = await getChangeInCumulativeGas(consumeTx)

      change.queued.should.equal(0)
      change.sequenced.should.equal(
        gasToConsume + OVM_TX_BASE_GAS_FEE + CONSUME_GAS_EXECUTION_OVERHEAD
      )
    })
    it('Should properly track queued consumed gas', async () => {
      const gasToConsume: number = 700_000
      const consumeGas = getConsumeGasCallback(
        timestamp,
        QUEUED_ORIGIN,
        gasToConsume
      )
      const change = await getChangeInCumulativeGas(consumeGas)

      change.sequenced.should.equal(0)
      change.queued.should.equal(
        gasToConsume + OVM_TX_BASE_GAS_FEE + CONSUME_GAS_EXECUTION_OVERHEAD
      )
    })
    it('Should properly track both queue and sequencer consumed gas', async () => {
      const sequencerGasToConsume = 100_000
      const queueGasToConsume = 200_000

      const consumeQueuedGas = getConsumeGasCallback(
        timestamp,
        QUEUED_ORIGIN,
        queueGasToConsume
      )

      const consumeSequencedGas = getConsumeGasCallback(
        timestamp,
        SEQUENCER_ORIGIN,
        sequencerGasToConsume
      )

      const change = await getChangeInCumulativeGas(async () => {
        await consumeQueuedGas()
        await consumeSequencedGas()
      })

      change.sequenced.should.equal(
        sequencerGasToConsume +
          OVM_TX_BASE_GAS_FEE +
          CONSUME_GAS_EXECUTION_OVERHEAD
      )
      change.queued.should.equal(
        queueGasToConsume + OVM_TX_BASE_GAS_FEE + CONSUME_GAS_EXECUTION_OVERHEAD
      )
    })
  })
  describe('Gas rate limiting over multiple transactions', async () => {
    it('Should properly track gas over multiple transactions', async () => {
      const timestamp = 1
      const gasToConsumeFirst = 100_000
      const gasToConsumeSecond = 200_000

      const consumeQueuedGas = getConsumeGasCallback(
        timestamp,
        QUEUED_ORIGIN,
        gasToConsumeFirst
      )

      const consumeSequencedGas = getConsumeGasCallback(
        timestamp,
        QUEUED_ORIGIN,
        gasToConsumeSecond
      )

      const change = await getChangeInCumulativeGas(async () => {
        await consumeQueuedGas()
        await consumeSequencedGas()
      })

      change.sequenced.should.equal(0)
      change.queued.should.equal(
        gasToConsumeFirst +
          gasToConsumeSecond +
          2 * (OVM_TX_BASE_GAS_FEE + CONSUME_GAS_EXECUTION_OVERHEAD)
      )
    })
    // start in a new epoch since the deployment takes some gas
    const startTimestamp = 1 + GAS_RATE_LIMIT_EPOCH_IN_SECONDS
    const moreThanHalfGas: number = MAX_GAS_PER_EPOCH / 2 + 1000
    for (const [queueToFill, otherQueue] of [
      [QUEUED_ORIGIN, SEQUENCER_ORIGIN],
      [SEQUENCER_ORIGIN, QUEUED_ORIGIN],
    ]) {
      it('Should revert like-kind transactions in a full epoch, still allowing gas through the other queue', async () => {
        // Get us close to the limit
        const almostFillEpoch = getConsumeGasCallback(
          startTimestamp,
          queueToFill,
          moreThanHalfGas
        )
        await almostFillEpoch()
        // Now try a tx which goes over the limit
        const overFillEpoch = getConsumeGasCallback(
          startTimestamp,
          queueToFill,
          moreThanHalfGas
        )
        const failedTx = await overFillEpoch()
        await assertOvmTxRevertedWithMessage(
          failedTx,
          'Transaction gas limit exceeds remaining gas for this epoch and queue origin.',
          wallet
        )
        const useOtherQueue = getConsumeGasCallback(
          startTimestamp,
          otherQueue,
          moreThanHalfGas
        )
        const successTx = await useOtherQueue()
        await assertOvmTxDidNotRevert(successTx, wallet)
      }).timeout(30000)
      it('Should allow gas back in at the start of a new epoch', async () => {
        // Get us close to the limit
        const firstTx = await getConsumeGasCallback(
          startTimestamp,
          queueToFill,
          moreThanHalfGas
        )
        await firstTx()
        // TODO: assert gas was consumed here

        // Now consume more than half gas again, but in the next epoch
        const nextEpochTimestamp =
          startTimestamp + GAS_RATE_LIMIT_EPOCH_IN_SECONDS + 1
        const secondEpochTx = await getConsumeGasCallback(
          nextEpochTimestamp,
          queueToFill,
          moreThanHalfGas
        )
        const successTx = await secondEpochTx()
        await assertOvmTxDidNotRevert(successTx, wallet)
      }).timeout(30000)
    }
  })
  describe('StateManagerGasSanitizer - OVM Gas virtualization', async () => {
    const timestamp = 1
    const gasToConsume = 100_000
    const SM_IMPLEMENTATION = 'StateManagerImplementation'

    let GasConsumingProxy: ContractFactory
    let SimpleStorage: ContractFactory
    let simpleStorageAddress: string
    before(async () => {
      GasConsumingProxy = await ethers.getContractFactory('GasConsumingProxy')
      SimpleStorage = await ethers.getContractFactory(
        'SimpleStorageArgsFromCalldata'
      )
    })

    const key = numberToHexString(1234, 32)
    const val = numberToHexString(5678, 32)
    const setStorage = async (): Promise<any> => {
      const data = SimpleStorage.interface.encodeFunctionData('setStorage', [
        key,
        val,
      ])
      return executeTransaction(
        executionManager,
        wallet,
        simpleStorageAddress,
        data,
        false,
        1
      )
    }

    it('Should record OVM transactions with different state manager gas consumption consuming the same EM gas', async () => {
      executionManager = await deployAndRegister(
        resolver.addressResolver,
        wallet,
        'ExecutionManager',
        {
          factory: ExecutionManager,
          params: [
            resolver.addressResolver.address,
            NULL_ADDRESS,
            [
              OVM_TX_BASE_GAS_FEE,
              OVM_TX_MAX_GAS,
              GAS_RATE_LIMIT_EPOCH_IN_SECONDS,
              MAX_GAS_PER_EPOCH,
              MAX_GAS_PER_EPOCH,
            ],
          ],
        }
      )

      await deployAndRegister(
        resolver.addressResolver,
        wallet,
        'StateManager',
        {
          factory: StateManager,
          params: [],
        }
      )

      simpleStorageAddress = await manuallyDeployOvmContract(
        wallet,
        resolver.contracts.executionManager.provider,
        executionManager,
        SimpleStorage,
        [resolver.addressResolver.address],
        1
      )

      // get normal OVM gas change with normal full state manager
      const fullSateManagerTx = setStorage
      let fullStateManagerResult
      const fullStateManagerChange = await getChangeInCumulativeGas(
        async () => {
          fullStateManagerResult = await fullSateManagerTx()
        }
      )

      executionManager = await deployAndRegister(
        resolver.addressResolver,
        wallet,
        'ExecutionManager',
        {
          factory: ExecutionManager,
          params: [
            resolver.addressResolver.address,
            NULL_ADDRESS,
            [
              OVM_TX_BASE_GAS_FEE,
              OVM_TX_MAX_GAS,
              GAS_RATE_LIMIT_EPOCH_IN_SECONDS,
              MAX_GAS_PER_EPOCH,
              MAX_GAS_PER_EPOCH,
            ],
          ],
        }
      )

      await deployAndRegister(
        resolver.addressResolver,
        wallet,
        'StateManager',
        {
          factory: GasConsumingProxy,
          params: [resolver.addressResolver.address, SM_IMPLEMENTATION],
        }
      )

      const stateManagerImplementation = await deployAndRegister(
        resolver.addressResolver,
        wallet,
        SM_IMPLEMENTATION,
        {
          factory: StateManager,
          params: [],
        }
      )

      gasConsumerAddress = await manuallyDeployOvmContract(
        wallet,
        provider,
        executionManager,
        GasConsumer,
        [],
        INITIAL_OVM_DEPLOY_TIMESTAMP
      )

      // get normal OVM gas change with normal full state manager
      const proxiedFullStateManagerTx = setStorage
      let proxiedFullStateManagerResult
      const proxiedFullStateManagerChange = await getChangeInCumulativeGas(
        async () => {
          proxiedFullStateManagerResult = await proxiedFullStateManagerTx()
        }
      )

      proxiedFullStateManagerChange.should.deep.equal(fullStateManagerChange)
    })
  })
})
