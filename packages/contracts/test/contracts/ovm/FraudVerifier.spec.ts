import { expect } from '../../setup'

/* External Imports */
import { ethers } from '@nomiclabs/buidler'
import { Contract, ContractFactory, Signer } from 'ethers'
import { TestUtils } from '@eth-optimism/core-utils'

/* Internal Imports */
import {
  TxChainBatch,
  StateChainBatch,
  makeAddressResolver,
  deployAndRegister,
  AddressResolverMapping,
  makeDummyOvmTransaction,
  encodeOvmTransaction,
  appendAndGenerateTransactionBatch,
  appendAndGenerateStateBatch
} from '../../test-helpers'

/* Tests */
describe('FraudVerifier', () => {
  const DUMMY_STATE_BATCH = [
    '0x' + '01'.repeat(32),
    '0x' + '02'.repeat(32),
    '0x' + '03'.repeat(32),
    '0x' + '04'.repeat(32),
  ]

  // Must create these when the tests are executed or the timestamp will be
  // invalid when we have a lot of tests to run.
  const DUMMY_TRANSACTION_BATCH = DUMMY_STATE_BATCH.map((element) => {
    return makeDummyOvmTransaction(element)
  })
  const ENCODED_DUMMY_TRANSACTION_BATCH = DUMMY_TRANSACTION_BATCH.map(
    (transaction) => {
      return encodeOvmTransaction(transaction)
    }
  )

  let wallet: Signer
  let sequencer: Signer
  let l1ToL2TransactionPasser: Signer
  before(async () => {
    ;[wallet, sequencer, l1ToL2TransactionPasser] = await ethers.getSigners()
  })

  let resolver: AddressResolverMapping
  before(async () => {
    resolver = await makeAddressResolver(wallet)
  })

  let CanonicalTransactionChain: ContractFactory
  let StateCommitmentChain: ContractFactory
  let FraudVerifier: ContractFactory
  let StubStateTransitioner: ContractFactory
  before(async () => {
    CanonicalTransactionChain = await ethers.getContractFactory(
      'CanonicalTransactionChain'
    )
    StateCommitmentChain = await ethers.getContractFactory(
      'StateCommitmentChain'
    )
    FraudVerifier = await ethers.getContractFactory('FraudVerifier')
    StubStateTransitioner = await ethers.getContractFactory(
      'StubStateTransitioner'
    )
  })

  let canonicalTransactionChain: Contract
  let stateCommitmentChain: Contract
  let fraudVerifier: Contract
  beforeEach(async () => {
    canonicalTransactionChain = await deployAndRegister(
      resolver.addressResolver,
      wallet,
      'CanonicalTransactionChain',
      {
        factory: CanonicalTransactionChain,
        params: [
          resolver.addressResolver.address,
          await sequencer.getAddress(),
          await l1ToL2TransactionPasser.getAddress(),
          100000,
        ],
      }
    )

    stateCommitmentChain = await deployAndRegister(
      resolver.addressResolver,
      wallet,
      'StateCommitmentChain',
      {
        factory: StateCommitmentChain,
        params: [resolver.addressResolver.address],
      }
    )

    fraudVerifier = await deployAndRegister(
      resolver.addressResolver,
      wallet,
      'FraudVerifier',
      {
        factory: FraudVerifier,
        params: [resolver.addressResolver.address],
      }
    )
  })

  let transactionBatch: TxChainBatch
  let stateBatch: StateChainBatch
  beforeEach(async () => {
    transactionBatch = await appendAndGenerateTransactionBatch(
      canonicalTransactionChain,
      sequencer,
      ENCODED_DUMMY_TRANSACTION_BATCH
    )

    stateBatch = await appendAndGenerateStateBatch(
      stateCommitmentChain,
      DUMMY_STATE_BATCH
    )
  })

  describe('initializeFraudVerification', async () => {
    it('should correctly initialize with a valid state root and transaction', async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      const transaction = DUMMY_TRANSACTION_BATCH[0]
      const transactionIndex = transactionBatch.getPosition(0)
      const transactionProof = await transactionBatch.getElementInclusionProof(
        0
      )

      await fraudVerifier.initializeFraudVerification(
        transactionIndex,
        preStateRoot,
        preStateRootProof,
        transaction,
        transactionProof
      )

      expect(
        await fraudVerifier.hasStateTransitioner(transactionIndex, preStateRoot)
      ).to.equal(true)
    })

    it('should return if initializing twice', async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      const transaction = DUMMY_TRANSACTION_BATCH[0]
      const transactionIndex = transactionBatch.getPosition(0)
      const transactionProof = await transactionBatch.getElementInclusionProof(
        0
      )

      await fraudVerifier.initializeFraudVerification(
        transactionIndex,
        preStateRoot,
        preStateRootProof,
        transaction,
        transactionProof
      )

      expect(
        await fraudVerifier.hasStateTransitioner(transactionIndex, preStateRoot)
      ).to.equal(true)

      // Initializing again should execute correctly without actually creating
      // a new state transitioner.
      await fraudVerifier.initializeFraudVerification(
        transactionIndex,
        preStateRoot,
        preStateRootProof,
        transaction,
        transactionProof
      )

      expect(
        await fraudVerifier.hasStateTransitioner(transactionIndex, preStateRoot)
      ).to.equal(true)
    })

    it('should reject an invalid state root', async () => {
      // Using the wrong state root.
      const preStateRoot = DUMMY_STATE_BATCH[1]
      const preStateRootProof = await stateBatch.getElementInclusionProof(1)

      const transaction = DUMMY_TRANSACTION_BATCH[0]
      const transactionIndex = transactionBatch.getPosition(0)
      const transactionProof = await transactionBatch.getElementInclusionProof(
        0
      )

      await TestUtils.assertRevertsAsync(
        'Provided pre-state root inclusion proof is invalid.',
        async () => {
          await fraudVerifier.initializeFraudVerification(
            transactionIndex,
            preStateRoot,
            preStateRootProof,
            transaction,
            transactionProof
          )
        }
      )

      expect(
        await fraudVerifier.hasStateTransitioner(transactionIndex, preStateRoot)
      ).to.equal(false)
    })

    it('should reject an invalid transaction', async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      // Using the wrong transaction data.
      const transaction = DUMMY_TRANSACTION_BATCH[1]
      const transactionIndex = transactionBatch.getPosition(0)
      const transactionProof = await transactionBatch.getElementInclusionProof(
        0
      )

      await TestUtils.assertRevertsAsync(
        'Provided transaction data is invalid.',
        async () => {
          await fraudVerifier.initializeFraudVerification(
            transactionIndex,
            preStateRoot,
            preStateRootProof,
            transaction,
            transactionProof
          )
        }
      )

      expect(
        await fraudVerifier.hasStateTransitioner(transactionIndex, preStateRoot)
      ).to.equal(false)
    })
  })

  describe('finalizeFraudVerification', async () => {
    let stubStateTransitioner: Contract
    beforeEach(async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      const transaction = DUMMY_TRANSACTION_BATCH[0]
      const transactionIndex = transactionBatch.getPosition(0)
      const transactionProof = await transactionBatch.getElementInclusionProof(
        0
      )

      await fraudVerifier.initializeFraudVerification(
        transactionIndex,
        preStateRoot,
        preStateRootProof,
        transaction,
        transactionProof
      )

      const stateTransitionerAddress = await fraudVerifier.stateTransitioners(
        transactionIndex
      )
      stubStateTransitioner = StubStateTransitioner.attach(
        stateTransitionerAddress
      )
    })

    it('should correctly finalize when the computed state root differs', async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      const postStateRoot = DUMMY_STATE_BATCH[1]
      const postStateRootProof = await stateBatch.getElementInclusionProof(1)

      const transactionIndex = transactionBatch.getPosition(0)

      await stubStateTransitioner.setStateRoot('0x' + '00'.repeat(32))
      await stubStateTransitioner.completeTransition()

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)

      await fraudVerifier.finalizeFraudVerification(
        transactionIndex,
        preStateRoot,
        preStateRootProof,
        postStateRoot,
        postStateRootProof
      )

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(0)
    })

    it('should revert when the state transitioner has not been finalized', async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      const postStateRoot = DUMMY_STATE_BATCH[1]
      const postStateRootProof = await stateBatch.getElementInclusionProof(1)

      const transactionIndex = transactionBatch.getPosition(0)

      // Not finalizing the state transitioner.
      await stubStateTransitioner.setStateRoot('0x' + '00'.repeat(32))

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)

      await TestUtils.assertRevertsAsync(
        'State transition process has not been completed.',
        async () => {
          await fraudVerifier.finalizeFraudVerification(
            transactionIndex,
            preStateRoot,
            preStateRootProof,
            postStateRoot,
            postStateRootProof
          )
        }
      )

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)
    })

    it('should revert when the provided pre-state root is for the wrong transition index', async () => {
      // Using the wrong pre-state root.
      const preStateRoot = DUMMY_STATE_BATCH[1]
      const preStateRootProof = await stateBatch.getElementInclusionProof(1)

      const postStateRoot = DUMMY_STATE_BATCH[1]
      const postStateRootProof = await stateBatch.getElementInclusionProof(1)

      const transactionIndex = transactionBatch.getPosition(0)

      await stubStateTransitioner.setStateRoot('0x' + '00'.repeat(32))
      await stubStateTransitioner.completeTransition()

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)

      await TestUtils.assertRevertsAsync(
        'Provided pre-state root does not match StateTransitioner.',
        async () => {
          await fraudVerifier.finalizeFraudVerification(
            transactionIndex,
            preStateRoot,
            preStateRootProof,
            postStateRoot,
            postStateRootProof
          )
        }
      )

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)
    })

    it('should revert when the provided pre-state root is invalid', async () => {
      // Using the right root with an invalid proof.
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(1)

      const postStateRoot = DUMMY_STATE_BATCH[1]
      const postStateRootProof = await stateBatch.getElementInclusionProof(1)

      const transactionIndex = transactionBatch.getPosition(0)

      await stubStateTransitioner.setStateRoot('0x' + '00'.repeat(32))
      await stubStateTransitioner.completeTransition()

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)

      await TestUtils.assertRevertsAsync(
        'Provided pre-state root inclusion proof is invalid.',
        async () => {
          await fraudVerifier.finalizeFraudVerification(
            transactionIndex,
            preStateRoot,
            preStateRootProof,
            postStateRoot,
            postStateRootProof
          )
        }
      )

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)
    })

    it('should revert when the provided post-state root is invalid', async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      // Using the wrong pre-state root.
      const postStateRoot = DUMMY_STATE_BATCH[2]
      const postStateRootProof = await stateBatch.getElementInclusionProof(2)

      const transactionIndex = transactionBatch.getPosition(0)

      await stubStateTransitioner.setStateRoot('0x' + '00'.repeat(32))
      await stubStateTransitioner.completeTransition()

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)

      await TestUtils.assertRevertsAsync(
        'Provided post-state root inclusion proof is invalid.',
        async () => {
          await fraudVerifier.finalizeFraudVerification(
            transactionIndex,
            preStateRoot,
            preStateRootProof,
            postStateRoot,
            postStateRootProof
          )
        }
      )

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)
    })

    it('should revert when the provided post-state root matches the state transitioner', async () => {
      const preStateRoot = DUMMY_STATE_BATCH[0]
      const preStateRootProof = await stateBatch.getElementInclusionProof(0)

      const postStateRoot = DUMMY_STATE_BATCH[1]
      const postStateRootProof = await stateBatch.getElementInclusionProof(1)

      const transactionIndex = transactionBatch.getPosition(0)

      // Setting the root to match the given post-state root.
      await stubStateTransitioner.setStateRoot(postStateRoot)
      await stubStateTransitioner.completeTransition()

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)

      await TestUtils.assertRevertsAsync(
        'State transition has not been proven fraudulent.',
        async () => {
          await fraudVerifier.finalizeFraudVerification(
            transactionIndex,
            preStateRoot,
            preStateRootProof,
            postStateRoot,
            postStateRootProof
          )
        }
      )

      expect(await stateCommitmentChain.getBatchesLength()).to.equal(1)
    })
  })
})
