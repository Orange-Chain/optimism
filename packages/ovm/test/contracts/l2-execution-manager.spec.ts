import '../setup'

/* External Imports */
import { add0x, getLogger } from '@eth-optimism/core-utils'
import { Contract, ethers } from 'ethers'
import { createMockProvider, deployContract, getWallets } from 'ethereum-waffle'

/* Contract Imports */
import * as L2ExecutionManager from '../../build/contracts/L2ExecutionManager.json'

/* Internal Imports */
import { DEFAULT_OPCODE_WHITELIST_MASK, GAS_LIMIT } from '../../src/app'
import { DEFAULT_ETHNODE_GAS_LIMIT } from '../helpers'

const log = getLogger('l2-execution-manager-calls', true)

export const abi = new ethers.utils.AbiCoder()

/*********
 * TESTS *
 *********/

const zero32: string = add0x('00'.repeat(32))
const key: string = add0x('01'.repeat(32))
const value: string = add0x('02'.repeat(32))

describe('L2 Execution Manager', () => {
  const provider = createMockProvider({ gasLimit: DEFAULT_ETHNODE_GAS_LIMIT })
  const [wallet] = getWallets(provider)
  // Create pointers to our execution manager & simple copier contract
  let l2ExecutionManager: Contract

  /* Deploy contracts before each test */
  beforeEach(async () => {
    // Deploy the execution manager
    l2ExecutionManager = await deployContract(
      wallet,
      L2ExecutionManager,
      [DEFAULT_OPCODE_WHITELIST_MASK, '0x' + '00'.repeat(20), GAS_LIMIT, true],
      { gasLimit: DEFAULT_ETHNODE_GAS_LIMIT }
    )
  })

  describe('Store external-to-internal tx hash map', async () => {
    it('properly maps OVM tx hash to internal tx hash', async () => {
      await l2ExecutionManager.mapOvmTransactionHashToInternalTransactionHash(
        key,
        value
      )
    })

    it('properly reads non-existent mapping', async () => {
      const result = await l2ExecutionManager.getInternalTransactionHash(key)
      result.should.equal(zero32, 'Incorrect unpopulated result!')
    })

    it('properly reads existing mapping', async () => {
      await l2ExecutionManager.mapOvmTransactionHashToInternalTransactionHash(
        key,
        value
      )
      const result = await l2ExecutionManager.getInternalTransactionHash(key)
      result.should.equal(value, 'Incorrect populated result!')
    })
  })
})
