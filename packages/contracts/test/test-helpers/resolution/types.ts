/* External Imports */
import { Contract, ContractFactory } from 'ethers'

export interface ContractDeployConfig {
  factory: ContractFactory
  params: any[]
}

type ContractFactoryName =
  | 'GasConsumer'
  | 'DeployerWhitelist'
  | 'L1ToL2TransactionQueue'
  | 'SafetyTransactionQueue'
  | 'CanonicalTransactionChain'
  | 'StateCommitmentChain'
  | 'StateManager'
  | 'ExecutionManager'
  | 'SafetyChecker'
  | 'FraudVerifier'

export interface AddressResolverDeployConfig {
  GasConsumer: ContractDeployConfig
  DeployerWhitelist: ContractDeployConfig
  L1ToL2TransactionQueue: ContractDeployConfig
  SafetyTransactionQueue: ContractDeployConfig
  CanonicalTransactionChain: ContractDeployConfig
  StateCommitmentChain: ContractDeployConfig
  StateManager: ContractDeployConfig
  ExecutionManager: ContractDeployConfig
  SafetyChecker: ContractDeployConfig
  FraudVerifier: ContractDeployConfig
}

export interface AddressResolverConfig {
  deployConfig: AddressResolverDeployConfig
  dependencies: ContractFactoryName[]
}

interface ContractMapping {
  gasConsumer: Contract
  deployerWhitelist: Contract
  l1ToL2TransactionQueue: Contract
  safetyTransactionQueue: Contract
  canonicalTransactionChain: Contract
  stateCommitmentChain: Contract
  stateManager: Contract
  executionManager: Contract
  safetyChecker: Contract
  fraudVerifier: Contract
}

export interface AddressResolverMapping {
  addressResolver: Contract
  contracts: ContractMapping
}

export const factoryToContractName = {
  GasConsumer: 'gasConsumer',
  DeployerWhitelist: 'deployerWhitelist',
  L1ToL2TransactionQueue: 'l1ToL2TransactionQueue',
  SafetyTransactionQueue: 'safetyTransactionQueue',
  CanonicalTransactionChain: 'canonicalTransactionChain',
  StateCommitmentChain: 'stateCommitmentChain',
  StateManager: 'stateManager',
  ExecutionManager: 'executionManager',
  SafetyChecker: 'safetyChecker',
  FraudVerifier: 'fraudVerifier',
}
