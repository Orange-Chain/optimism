/* External Imports */
import {
  Opcode,
  EVMOpcode,
  EVMOpcodeAndBytes,
  EVMBytecode,
  isValidOpcodeAndBytes,
  Address,
} from '@eth-optimism/rollup-core'
import {
  bufToHexString,
  remove0x,
  getLogger,
  isValidHexAddress,
  hexStrToBuf,
} from '@eth-optimism/core-utils'

/* Internal Imports */
import { OpcodeReplacer } from '../../types/transpiler'
import {
  InvalidAddressError,
  InvalidBytesConsumedError,
  UnsupportedOpcodeError,
} from '../../index'
import {
  getCALLReplacement,
  getSTATICCALLReplacement,
  getDELEGATECALLReplacement,
  getEXTCODECOPYReplacement,
} from './dynamic-memory-opcodes'
import {
  getCREATEReplacement,
  getCREATE2Replacement,
} from './contract-creation-opcodes'
import {
  getADDRESSReplacement,
  getCALLERReplacement,
  getEXTCODEHASHReplacement,
  getEXTCODESIZEReplacement,
  getORIGINReplacement,
  getSLOADReplacement,
  getSSTOREReplacement,
  getTIMESTAMPReplacement,
} from './static-memory-opcodes'

const log = getLogger('transpiler:opcode-replacement')

export class OpcodeReplacerImpl implements OpcodeReplacer {
  public static EX_MGR_PLACEHOLDER: Buffer = Buffer.from(
    `{execution manager address placeholder}`
  )
  private readonly excutionManagerAddressBuffer: Buffer

  /**
   * Creates an OpcodeReplacer, validating the provided address and any given replacements.
   *
   * @param executionManagerAddress The address of the ExecutionManager -- all calls get routed through this contract.
   * @param optionalReplacements Optional opcodes to replace with bytecode.
   */
  constructor(
    executionManagerAddress: Address,
    private readonly optionalReplacements: Map<
      EVMOpcode,
      EVMBytecode
    > = new Map<EVMOpcode, EVMBytecode>()
  ) {
    // check and store address
    if (!isValidHexAddress(executionManagerAddress)) {
      const msg: string = `Opcode replacer received ${executionManagerAddress} for the execution manager address.  Not a valid hex string address!`
      log.error(msg)
      throw new InvalidAddressError(msg)
    }

    this.excutionManagerAddressBuffer = hexStrToBuf(executionManagerAddress)

    for (const [
      toReplace,
      bytecodeToReplaceWith,
    ] of optionalReplacements.entries()) {
      // Make sure we're not attempting to overwrite PUSHN, not yet supported
      if (toReplace.programBytesConsumed > 0) {
        const msg: string = `Transpilation currently does not support opcodes which consume bytes, but config specified a replacement for ${JSON.stringify(
          toReplace
        )}.`
        log.error(msg)
        throw new UnsupportedOpcodeError(msg)
      }

      // for each operation in the replacement bytecode for this toReplace...
      for (const replacementBytes of bytecodeToReplaceWith) {
        // ... replace execution manager placeholder
        if (
          !!replacementBytes.consumedBytes &&
          replacementBytes.consumedBytes.equals(
            OpcodeReplacerImpl.EX_MGR_PLACEHOLDER
          )
        ) {
          replacementBytes.consumedBytes = this.excutionManagerAddressBuffer
        }

        // ...type check consumed bytes are the right length
        if (!isValidOpcodeAndBytes(replacementBytes)) {
          const msg: string = `Replacement config specified a ${
            replacementBytes.opcode.name
          } as an operation in the replacement bytecode for ${
            toReplace.name
          }, but the consumed bytes specified was ${bufToHexString(
            replacementBytes.consumedBytes
          )}--invalid length! (length ${replacementBytes.consumedBytes.length})`
          log.error(msg)
          throw new InvalidBytesConsumedError(msg)
        }
      }
    }
  }

  /**
   * Gets the specified replacement bytecode for a given EVM opcode and bytes
   * @param opcodeAndBytes EVM opcode and consumed bytes which is supposed to be replaced.
   *
   * @returns The EVMBytecode we have decided to replace opcodeAndBytes with.
   */
  public replaceIfNecessary(opcodeAndBytes: EVMOpcodeAndBytes): EVMBytecode {
    const replacement: EVMBytecode = this.getMandatoryReplacement(
      opcodeAndBytes
    )
    if (!!replacement) {
      return replacement
    }

    if (!this.optionalReplacements.has(opcodeAndBytes.opcode)) {
      return [opcodeAndBytes]
    } else {
      return this.optionalReplacements.get(opcodeAndBytes.opcode)
    }
  }

  private getMandatoryReplacement(
    opcodeAndBytes: EVMOpcodeAndBytes
  ): EVMBytecode {
    switch (opcodeAndBytes.opcode) {
      case Opcode.ADDRESS:
        return getADDRESSReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.CALL:
        return getCALLReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.CALLER:
        return getCALLERReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.CREATE:
        return getCREATEReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.CREATE2:
        return getCREATE2Replacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.DELEGATECALL:
        return getDELEGATECALLReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.EXTCODECOPY:
        return getEXTCODECOPYReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.EXTCODEHASH:
        return getEXTCODEHASHReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.EXTCODESIZE:
        return getEXTCODESIZEReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.ORIGIN:
        return getORIGINReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.SLOAD:
        return getSLOADReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.SSTORE:
        return getSSTOREReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.STATICCALL:
        return getSTATICCALLReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      case Opcode.TIMESTAMP:
        return getTIMESTAMPReplacement(
          bufToHexString(this.excutionManagerAddressBuffer)
        )
      default:
        return undefined
    }
  }
}
