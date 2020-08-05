/* External Imports */
import { getLogger } from '@eth-optimism/core-utils'
import { Signer } from 'ethers'

/* Internal Imports */
import { AddressResolverMapping, RollupOptions } from './types'
import {
  GAS_LIMIT,
  getL1ContractOwnerAddress,
  getL1DeploymentSigner,
  getL1SequencerAddress,
} from './config'
import { Environment } from './environment'
import { deployAllContracts } from './contract-deploy'

const log = getLogger('deploy-l1-rollup-contracts')

/**
 * Deploys all L1 contracts according to the environment variable configuration.
 * Please see README for more info.
 */
export const deployContracts = async (): Promise<AddressResolverMapping> => {
  let res: AddressResolverMapping
  try {
    const signer: Signer = getL1DeploymentSigner()
    log.info(`Read deployer wallet info. Address: ${await signer.getAddress()}`)

    const ownerAddress: string = await getL1ContractOwnerAddress()
    const sequencerAddress: string = getL1SequencerAddress()
    const rollupOptions: RollupOptions = {
      blockGasLimit: GAS_LIMIT,
      forceInclusionPeriodSeconds: Environment.forceInclusionPeriodSeconds(),
      ownerAddress,
      sequencerAddress,
    }

    res = await deployAllContracts({
      signer,
      rollupOptions,
      addressResolverContractAddress: Environment.addressResolverContractAddress()
    })
  } catch (e) {
    log.error(`Error deploying contracts: ${e.message}`)
    return undefined
  }

  log.info(`\n\nSuccessfully deployed the following contracts:`)
  log.info(`\tAddressResolver: ${res.addressResolver.address}`)
  Object.keys(res.contracts).forEach((key) => {
    if (res.contracts[key]) {
      log.info(`\t${key}: ${res.contracts[key].address}`)
    }
  })
}
