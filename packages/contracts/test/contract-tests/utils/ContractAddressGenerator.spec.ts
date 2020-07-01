import '../../setup'

/* External Imports */
import { getLogger } from '@eth-optimism/core-utils'
import { createMockProvider, deployContract, getWallets } from 'ethereum-waffle'
import { utils, Contract } from 'ethers'

/* Internal Imports */
import { create2Tests } from '../../test-helpers/data/create2.test.json'
import { DEFAULT_ETHNODE_GAS_LIMIT } from '../../test-helpers/core-helpers'
import { buildCreate2Address } from '../../test-helpers'

/* Contract Imports */
import { ContractAddressGeneratorContractDefinition } from '../../../src'

/* Logging */
const log = getLogger('contract-address-generator', true)

/* Tests */
describe('ContractAddressGenerator', () => {
  const [wallet1, wallet2] = getWallets(
    createMockProvider({ gasLimit: DEFAULT_ETHNODE_GAS_LIMIT })
  )
  let contractAddressGenerator: Contract

  beforeEach(async () => {
    contractAddressGenerator = await deployContract(
      wallet1,
      ContractAddressGeneratorContractDefinition,
      [],
      {
        gasLimit: DEFAULT_ETHNODE_GAS_LIMIT,
      }
    )
  })

  describe('getAddressFromCREATE', async () => {
    it('returns expected address, nonce: 1', async () => {
      const nonce = 1
      const expectedAddress = utils.getContractAddress({
        from: wallet1.address,
        nonce,
      })
      const computedAddress = await contractAddressGenerator.getAddressFromCREATE(
        wallet1.address,
        nonce
      )
      computedAddress.should.equal(expectedAddress)
    })

    it('returns expected address, nonce: 1, different origin address', async () => {
      const nonce = 1
      const expectedAddress = utils.getContractAddress({
        from: wallet2.address,
        nonce,
      })
      const computedAddress = await contractAddressGenerator.getAddressFromCREATE(
        wallet2.address,
        nonce
      )
      computedAddress.should.equal(expectedAddress)
    })

    it('returns expected address, nonce: 999999999 ', async () => {
      const nonce = 999999999
      const expectedAddress = utils.getContractAddress({
        from: wallet1.address,
        nonce,
      })
      const computedAddress = await contractAddressGenerator.getAddressFromCREATE(
        wallet1.address,
        nonce
      )
      computedAddress.should.equal(expectedAddress)
    })

    // test around nonce 128, or 0x80, due to edge cases. See https://github.com/ethereum/wiki/wiki/RLP#definition
    for (let nonce = 127; nonce < 129; nonce++) {
      it(`returns expected address, nonce: ${nonce}`, async () => {
        const expectedAddress = utils.getContractAddress({
          from: wallet1.address,
          nonce,
        })
        const computedAddress = await contractAddressGenerator.getAddressFromCREATE(
          wallet1.address,
          nonce
        )
        computedAddress.should.equal(expectedAddress)
      })
    }
  })

  describe('buildCreate2Address helper', async () => {
    for (const test of Object.keys(create2Tests)) {
      it(`should properly generate CREATE2 address from ${test}`, async () => {
        const { address, salt, init_code, result } = create2Tests[test]
        const computedAddress = buildCreate2Address(address, salt, init_code)
        computedAddress.should.equal(result.toLowerCase())
      })
    }
  })

  describe('getAddressFromCREATE2', async () => {
    for (const test of Object.keys(create2Tests)) {
      it(`should properly generate CREATE2 address from ${test}`, async () => {
        const { address, salt, init_code, result } = create2Tests[test]
        const computedAddress = await contractAddressGenerator.getAddressFromCREATE2(
          address,
          salt,
          init_code
        )
        computedAddress.toLowerCase().should.equal(result.toLowerCase())
      })
    }
  })
})
