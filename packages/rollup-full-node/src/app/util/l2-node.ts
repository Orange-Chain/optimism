/* Externals Import */
import {
  add0x,
  getDeployedContractAddress,
  getLogger,
  logError,
} from '@eth-optimism/core-utils'
import { deployContract, Environment } from '@eth-optimism/rollup-core'
import { getContractDefinition } from '@eth-optimism/rollup-contracts'

import { Contract, Wallet } from 'ethers'
import { JsonRpcProvider } from 'ethers/providers'
import { createMockProvider, getWallets } from 'ethereum-waffle'

/* Internal Imports */
import { Address, L2NodeContext } from '../../types'
import { CHAIN_ID, GAS_LIMIT } from '../constants'
import * as fs from 'fs'

const log = getLogger('l2-node')

const L2ExecutionManagerContractDefinition = getContractDefinition(
  'L2ExecutionManager'
)
const FullStateManagerContractDefinition = getContractDefinition(
  'FullStateManager'
)
const L2ToL1MessagePasserContractDefinition = getContractDefinition(
  'L2ToL1MessagePasser'
)
const StubSafetyCheckerContractDefinition = getContractDefinition(
  'StubSafetyChecker'
)
const AddressResolverContractDefinition = getContractDefinition(
  'AddressResolver'
)
const RLPEncodeContractDefinition = getContractDefinition('RLPEncode')
const ContractAddressGeneratorDefinition = getContractDefinition(
  'ContractAddressGenerator'
)

/* Configuration */

/**
 * Initializes the L2 Node, which entails:
 * - Creating a local instance if the given provider is undefined.
 * - Creating a wallet to use to interact with it.
 * - Deploying the ExecutionManager if it does not already exist.
 *
 * @param web3Provider (optional) The JsonRpcProvider to use to connect to a remote node.
 * @param doNotDeploy (optional) Set if this should error rather than deploying any chain or contracts.
 * @returns The L2NodeContext necessary to interact with the L2 Node.
 */
export async function initializeL2Node(
  web3Provider?: JsonRpcProvider,
  doNotDeploy?: boolean
): Promise<L2NodeContext> {
  if (doNotDeploy && !web3Provider) {
    const msg =
      'initializeL2Node is told not to deploy but there is no provider passed'
    log.error(msg)
    throw Error(msg)
  }

  const provider: JsonRpcProvider = web3Provider || deployLocalL2Node()
  const wallet: Wallet = getL2Wallet(provider)

  const executionManager: Contract = await getExecutionManagerContract(
    provider,
    wallet,
    doNotDeploy
  )
  const stateManager: Contract = new Contract(
    await executionManager.getStateManagerAddress(),
    FullStateManagerContractDefinition.abi,
    wallet
  )

  const l2ToL1MessagePasser: Contract = getL2ToL1MessagePasserContract(wallet)

  return {
    wallet,
    provider,
    executionManager,
    stateManager,
    l2ToL1MessagePasser,
  }
}

/**
 * Deploys a local L2 node and gets the resulting provider.
 * @returns The provider for use with the local node.
 */
function deployLocalL2Node(): JsonRpcProvider {
  const opts = {
    port: Environment.localL2NodePort(),
    gasLimit: GAS_LIMIT,
    allowUnlimitedContractSize: true,
  }
  const persistedGanacheDbPath = Environment.localL2NodePersistentDbPath()
  if (!!persistedGanacheDbPath) {
    log.info(
      `Found configuration for L1 Node DB Path: ${persistedGanacheDbPath}`
    )
    opts['db_path'] = persistedGanacheDbPath
    opts['network_id'] = CHAIN_ID
  }
  log.info(`Creating Local L2 Node with config: ${JSON.stringify(opts)}`)
  const provider = createMockProvider(opts)
  log.info(`Local L2 Node created!`)

  return provider
}

/**
 * Gets the wallet to use to interact with the L2 node. This may be configured via mnemonic
 * or path to private key file specified through environment variables. If not it is assumed
 * that a local test provider is being used, from which the wallet may be fetched.
 *
 * @param provider The provider with which the wallet will be associated.
 * @returns The wallet to use with the L2 node.
 */
function getL2Wallet(provider: JsonRpcProvider): Wallet {
  let wallet: Wallet
  if (!!Environment.l2WalletPrivateKey()) {
    wallet = new Wallet(add0x(Environment.l2WalletPrivateKey()), provider)
    log.info(`Initialized wallet from private key. Address: ${wallet.address}`)
  } else if (!!Environment.l2WalletMnemonic()) {
    wallet = Wallet.fromMnemonic(Environment.l2WalletMnemonic())
    wallet = wallet.connect(provider)
    log.info(`Initialized wallet from mnemonic. Address: ${wallet.address}`)
  } else if (!!Environment.l2WalletPrivateKeyPath()) {
    try {
      const pk: string = fs.readFileSync(Environment.l2WalletPrivateKeyPath(), {
        encoding: 'utf-8',
      })
      wallet = new Wallet(add0x(pk.trim()), provider)
      log.info(`Found wallet from PK file. Address: ${wallet.address}`)
    } catch (e) {
      logError(
        log,
        `Error creating wallet from PK path: ${Environment.l2WalletPrivateKeyPath()}`,
        e
      )
      throw e
    }
  } else {
    wallet = getWallets(provider)[0]
    log.info(
      `Getting wallet from provider. First wallet private key: [${wallet.privateKey}`
    )
  }

  if (!wallet) {
    const msg: string = `Wallet not created! Specify the L2_WALLET_MNEMONIC environment variable to set one!`
    log.error(msg)
    throw Error(msg)
  } else {
    log.info(`L2 wallet created. Address: ${wallet.address}`)
  }

  return wallet
}

/**
 * Gets the ExecutionManager contract to use with the L2 node. This will automatically
 * deploy a new ExecutionManager contract if one does not exist for the specified provider.
 *
 * @param provider The provider to use to determine if the contract has already been deployed.
 * @param wallet The wallet to use for the contract.
 * @param doNotDeploy Set if this should error instead of deploying the contract
 * @returns The Execution Manager contract.
 */
async function getExecutionManagerContract(
  provider: JsonRpcProvider,
  wallet: Wallet,
  doNotDeploy: boolean
): Promise<Contract> {
  const executionManagerAddress: Address =
    Environment.l2ExecutionManagerAddress() ||
    (await getDeployedContractAddress(0, provider, wallet.address))

  let executionManager: Contract
  if (executionManagerAddress) {
    log.info(
      `Using existing ExecutionManager deployed at ${executionManagerAddress}`
    )
    executionManager = new Contract(
      executionManagerAddress,
      L2ExecutionManagerContractDefinition.abi,
      wallet
    )
  } else {
    if (doNotDeploy) {
      const msg =
        'getExecutionManagerContract is told not to deploy but there is no configured contract address!'
      log.error(msg)
      throw Error(msg)
    }

    log.info(`Deploying execution manager!`)
    executionManager = await deployExecutionManager(wallet)
    log.info(
      `Execution Manager deployed at address ${executionManager.address}`
    )
  }

  return executionManager
}

/**
 * Deploys the ExecutionManager contract with the provided wallet and whitelist,
 * returning the resulting Contract.
 *
 * @param wallet The wallet to be used, containing all connection info.
 * @returns The deployed Contract.
 */
async function deployExecutionManager(wallet: Wallet): Promise<Contract> {
  log.debug('Deploying execution manager...')
  const addressResolver: Contract = await deployContract(
    wallet,
    AddressResolverContractDefinition,
    [],
    { gasLimit: GAS_LIMIT }
  )

  const stateManager: Contract = await deployContract(
    wallet,
    FullStateManagerContractDefinition,
    [],
    { gasLimit: GAS_LIMIT }
  )

  const stubSafetyChecker: Contract = await deployContract(
    wallet,
    StubSafetyCheckerContractDefinition,
    [],
    { gasLimit: GAS_LIMIT }
  )

  const rlpEncode: Contract = await deployContract(
    wallet,
    RLPEncodeContractDefinition,
    [],
    { gasLimit: GAS_LIMIT }
  )

  const contractAddressGenerator: Contract = await deployContract(
    wallet,
    ContractAddressGeneratorDefinition,
    [],
    { gasLimit: GAS_LIMIT }
  )

  await addressResolver.setAddress('StateManager', stateManager.address)
  await addressResolver.setAddress('SafetyChecker', stubSafetyChecker.address)
  await addressResolver.setAddress('RLPEncode', rlpEncode.address)
  await addressResolver.setAddress(
    'ContractAddressGenerator',
    contractAddressGenerator.address
  )

  const executionManager: Contract = await deployContract(
    wallet,
    L2ExecutionManagerContractDefinition,
    [addressResolver.address, wallet.address, GAS_LIMIT],
    { gasLimit: GAS_LIMIT }
  )

  await addressResolver.setAddress('ExecutionManager', executionManager.address)

  log.info('Deployed execution manager to address:', executionManager.address)

  return executionManager
}

/**
 * Gets the L2ToL1MessagePasserContract for use within the L2 Node.
 * This is automatically deployed to a predictable address within the
 * ExecutionManager, so it's just a matter of creating the contract wrapper.
 *
 * @param wallet The wallet to associate with the contract.
 * @returns The Message Passer contract.
 */
function getL2ToL1MessagePasserContract(wallet: Wallet): Contract {
  const l2ToL1MessagePasserOvmAddress: Address = Environment.l2ToL1MessagePasserOvmAddress()
  log.info(
    `Using existing L2ToL1MessagePasser deployed at ${l2ToL1MessagePasserOvmAddress}`
  )
  return new Contract(
    l2ToL1MessagePasserOvmAddress,
    L2ToL1MessagePasserContractDefinition.abi,
    wallet
  )
}

/**
 * Detects whether an internal L2 node error is due to an EVM revert or some other error
 *
 * @param e The error message reterned from either eth_sendRawTransaction or eth_call on the internal L2 node
 * @returns Whether the error is an EVM revert error or some other issue.
 */
export function isErrorEVMRevert(e: any): boolean {
  return (
    !!e.results &&
    !!Object.keys(e.results)[0] &&
    e.results[Object.keys(e.results)[0]].error === 'revert'
  )
}
