import { expect } from '../setup'

import { createMockProvider, deployContract, getWallets } from 'ethereum-waffle'
import { Contract } from 'ethers'

import * as MerkleTrie from '../../build/MerkleTrie.json'
import {
  makeAllProofTests,
  makeRandomProofTest,
  makeProofTest,
  makeUpdateTest,
  makeRandomUpdateTest,
} from '../helpers/trie-helpers'

describe('MerkleTrie', () => {
  const [wallet] = getWallets(createMockProvider())
  let trie: Contract
  beforeEach(async () => {
    trie = await deployContract(wallet, MerkleTrie)
  })

  describe('update', async () => {
    it(`should support basic leaf value updates`, async () => {
      const test = await makeUpdateTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key1aa',
        'some new value'
      )
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support new leaf insertions`, async () => {
      const test = await makeUpdateTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key4dd',
        'some new value'
      )
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support modifications to an extension node`, async () => {
      const test = await makeUpdateTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key1ab',
        'some new value'
      )
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support modifications shifting an existing value into a branch`, async () => {
      const test = await makeUpdateTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key1aaa',
        'some new value'
      )
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support modifications shifting the new value into a branch`, async () => {
      const test = await makeUpdateTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key1a',
        'some new value'
      )
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support random updates (128 nodes)`, async () => {
      const test = await makeRandomUpdateTest('seed.update.128', 128)
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support random updates (256 nodes)`, async () => {
      const test = await makeRandomUpdateTest('seed.update.256', 256)
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support random updates (512 nodes)`, async () => {
      const test = await makeRandomUpdateTest('seed.update.512', 512)
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support random updates (1024 nodes)`, async () => {
      const test = await makeRandomUpdateTest('seed.update.1024', 1024)
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })

    it(`should support random updates (2048 nodes)`, async () => {
      const test = await makeRandomUpdateTest('seed.update.2048', 2048)
      expect(
        await trie.update(test.key, test.val, test.proof, test.oldRoot)
      ).to.equal(test.newRoot)
    })
  })

  describe('verifyInclusionProof', async () => {
    it(`should verify basic proofs`, async () => {
      const tests = await makeAllProofTests([
        {
          key: 'key1aa',
          val: '0123456789012345678901234567890123456789xx',
        },
        {
          key: 'key2bb',
          val: 'aval2',
        },
        {
          key: 'key3cc',
          val: 'aval3',
        },
      ])
      for (const test of tests) {
        expect(
          await trie.verifyInclusionProof(
            test.key,
            test.val,
            test.proof,
            test.root
          )
        ).to.equal(true)
      }
    })

    it(`should verify a single long key`, async () => {
      const tests = await makeAllProofTests([
        {
          key: 'key1aa',
          val: '0123456789012345678901234567890123456789xx',
        },
      ])
      for (const test of tests) {
        expect(
          await trie.verifyInclusionProof(
            test.key,
            test.val,
            test.proof,
            test.root
          )
        ).to.equal(true)
      }
    })

    it(`should verify a single short key`, async () => {
      const tests = await makeAllProofTests([
        {
          key: 'key1aa',
          val: '01234',
        },
      ])
      for (const test of tests) {
        expect(
          await trie.verifyInclusionProof(
            test.key,
            test.val,
            test.proof,
            test.root
          )
        ).to.equal(true)
      }
    })

    it(`should verify a key in the middle`, async () => {
      const tests = await makeAllProofTests([
        {
          key: 'key1aa',
          val: '0123456789012345678901234567890123456789xxx',
        },
        {
          key: 'key1',
          val: '0123456789012345678901234567890123456789Very_Long',
        },
        {
          key: 'key2bb',
          val: 'aval3',
        },
        {
          key: 'key2',
          val: 'short',
        },
        {
          key: 'key3cc',
          val: 'aval3',
        },
        {
          key: 'key3',
          val: '1234567890123456789012345678901',
        },
      ])
      for (const test of tests) {
        expect(
          await trie.verifyInclusionProof(
            test.key,
            test.val,
            test.proof,
            test.root
          )
        ).to.equal(true)
      }
    })

    it(`should verify with embedded extension nodes`, async () => {
      const tests = await makeAllProofTests([
        {
          key: 'a',
          val: 'a',
        },
        {
          key: 'b',
          val: 'b',
        },
        {
          key: 'c',
          val: 'c',
        },
      ])
      for (const test of tests) {
        expect(
          await trie.verifyInclusionProof(
            test.key,
            test.val,
            test.proof,
            test.root
          )
        ).to.equal(true)
      }
    })

    it('should verify random data (128 nodes)', async () => {
      const test = await makeRandomProofTest('seed.inclusion.128', 128)
      expect(
        await trie.verifyInclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })

    it('should verify random data (256 nodes)', async () => {
      const test = await makeRandomProofTest('seed.inclusion.256', 256)
      expect(
        await trie.verifyInclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })

    it('should verify random data (512 nodes)', async () => {
      const test = await makeRandomProofTest('seed.inclusion.512', 512)
      expect(
        await trie.verifyInclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })

    it('should verify random data (1024 nodes)', async () => {
      const test = await makeRandomProofTest('seed.inclusion.1024', 1024)
      expect(
        await trie.verifyInclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })

    it('should verify random data (2048 nodes)', async () => {
      const test = await makeRandomProofTest('seed.inclusion.2048', 2048)
      expect(
        await trie.verifyInclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })
  })

  describe('verifyExclusionProof', () => {
    it('should verify exclusion with an existing key and differing value', async () => {
      const test = await makeProofTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key1aa',
        'not the correct value'
      )

      expect(
        await trie.verifyExclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })

    it('should verify exclusion with a non-existent extension of a leaf', async () => {
      const test = await makeProofTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key1aab',
        'some arbitrary value'
      )

      expect(
        await trie.verifyExclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })

    it('should verify exclusion with a non-existent extension of a branch', async () => {
      const test = await makeProofTest(
        [
          {
            key: 'key1aa',
            val: '0123456789012345678901234567890123456789xx',
          },
          {
            key: 'key2bb',
            val: 'aval2',
          },
          {
            key: 'key3cc',
            val: 'aval3',
          },
        ],
        'key4dd',
        'some arbitrary value'
      )

      expect(
        await trie.verifyExclusionProof(
          test.key,
          test.val,
          test.proof,
          test.root
        )
      ).to.equal(true)
    })
  })
})
