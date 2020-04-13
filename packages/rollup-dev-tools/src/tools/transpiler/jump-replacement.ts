import {
  bytecodeToBuffer,
  EVMBytecode,
  Opcode,
} from '@eth-optimism/rollup-core'
import { bufferUtils, getLogger } from '@eth-optimism/core-utils'
import { getPUSHOpcode, getPUSHIntegerOp } from './helpers'
import {
  JumpReplacementResult,
  TranspilationError,
  TranspilationErrors,
} from '../../types/transpiler'
import { createError } from './util'
import { buildJumpBSTBytecode, getJumpdestMatchSuccessBytecode } from './'

const log = getLogger('jump-replacement')

/**
 * Takes the provided transpiled bytecode and accounts for JUMPs that may not jump
 * to the intended spots now that transpilation has modified the code.
 *
 * @param transpiledBytecode The transpiled bytecode to operate on.
 * @param jumpdestIndexesBefore The ordered indexes of JUMPDESTs before.
 * @param errors The list of errors to append to if there is an error.
 * @returns The new bytecode with all JUMPs accounted for.
 */
export const accountForJumps = (
  transpiledBytecode: EVMBytecode,
  jumpdestIndexesBefore: number[]
): JumpReplacementResult => {
  if (jumpdestIndexesBefore.length === 0) {
    return { bytecode: transpiledBytecode }
  }
  const errors: TranspilationError[] = []

  const footerSwitchJumpdestIndex: number = getExpectedFooterSwitchStatementJumpdestIndex(
    transpiledBytecode
  )
  const jumpdestIndexesAfter: number[] = []
  const replacedBytecode: EVMBytecode = []
  let pc: number = 0
  // Replace all JUMP, JUMPI, and JUMPDEST, and build the post-transpilation JUMPDEST index array.
  for (const opcodeAndBytes of transpiledBytecode) {
    if (opcodeAndBytes.opcode === Opcode.JUMP) {
      replacedBytecode.push(
        ...getJumpReplacementBytecode(footerSwitchJumpdestIndex)
      )
      pc += getJumpReplacementBytecodeLength()
    } else if (opcodeAndBytes.opcode === Opcode.JUMPI) {
      replacedBytecode.push(
        ...getJumpiReplacementBytecode(footerSwitchJumpdestIndex)
      )
      pc += getJumpiReplacementBytecodeLength()
    } else if (opcodeAndBytes.opcode === Opcode.JUMPDEST) {
      replacedBytecode.push(opcodeAndBytes)
      jumpdestIndexesAfter.push(pc)
      pc += 1
    } else {
      replacedBytecode.push(opcodeAndBytes)
      pc += 1 + opcodeAndBytes.opcode.programBytesConsumed
    }
  }

  if (jumpdestIndexesBefore.length !== jumpdestIndexesAfter.length) {
    const message: string = `There were ${jumpdestIndexesBefore.length} JUMPDESTs before transpilation, but there are ${jumpdestIndexesAfter.length} JUMPDESTs after.`
    log.debug(message)
    errors.push(
      createError(-1, TranspilationErrors.INVALID_SUBSTITUTION, message)
    )
    return { bytecode: transpiledBytecode, errors }
  }

  // Add the logic to handle the pre-transpilation to post-transpilation jump dest mapping.
  replacedBytecode.push(
    ...buildJumpBSTBytecode(
      jumpdestIndexesBefore,
      jumpdestIndexesAfter,
      bytecodeToBuffer(replacedBytecode).length
    )
  )

  return { bytecode: replacedBytecode, errors }
}

let jumpReplacementLength: number
export const getJumpReplacementBytecodeLength = (): number => {
  if (jumpReplacementLength === undefined) {
    jumpReplacementLength = bytecodeToBuffer(getJumpReplacementBytecode(0))
      .length
  }
  return jumpReplacementLength
}

let jumpiReplacementLength: number
export const getJumpiReplacementBytecodeLength = (): number => {
  if (jumpiReplacementLength === undefined) {
    jumpiReplacementLength = bytecodeToBuffer(getJumpiReplacementBytecode(0))
      .length
  }
  return jumpiReplacementLength
}

/**
 * Gets the replacement bytecode for a JUMP operation, given the provided
 * index of the footer switch statement JUMPDEST.
 * See: https://github.com/op-optimism/optimistic-rollup/wiki/Transpiler#jump-transpilation-approach
 * for more information on why this is necessary and how replacement occurs.
 *
 * @param footerSwitchJumpdestIndex The index of the footer JUMPDEST.
 * @returns The EVMBytecode to replace JUMP EVMBytecode with.
 */
export const getJumpReplacementBytecode = (
  footerSwitchJumpdestIndex: number
): EVMBytecode => {
  const indexBuffer: Buffer = bufferUtils.numberToBufferPacked(
    footerSwitchJumpdestIndex,
    2
  )
  return [
    {
      opcode: getPUSHOpcode(indexBuffer.length),
      consumedBytes: indexBuffer,
    },
    {
      opcode: Opcode.JUMP,
      consumedBytes: undefined,
    },
  ]
}

/**
 * Gets the replacement bytecode for a JUMPI operation, given the provided
 * index of the footer switch statement JUMPDEST.
 * See: https://github.com/op-optimism/optimistic-rollup/wiki/Transpiler#jump-transpilation-approach
 * for more information on why this is necessary and how replacement occurs.
 *
 * @param footerSwitchJumpdestIndex The index of the footer JUMPDEST.
 * @returns The EVMBytecode to replace JUMPI EVMBytecode with.
 */
export const getJumpiReplacementBytecode = (
  footerSwitchJumpdestIndex: number
): EVMBytecode => {
  const indexBuffer: Buffer = bufferUtils.numberToBufferPacked(
    footerSwitchJumpdestIndex,
    2
  )
  return [
    {
      opcode: Opcode.SWAP1,
      consumedBytes: undefined,
    },
    {
      opcode: getPUSHOpcode(indexBuffer.length),
      consumedBytes: indexBuffer,
    },
    {
      opcode: Opcode.JUMPI,
      consumedBytes: undefined,
    },
    {
      opcode: Opcode.POP,
      consumedBytes: undefined,
    },
  ]
}

/**
 * Gets the expected index of the footer JUMP switch statement, given EVMBytecode
 * that will *only* change by replacing JUMP, JUMPI, and JUMPDEST with the appropriate
 * EVMBytecode.
 *
 * @param bytecode The bytecode in question.
 * @returns The expected index of the JUMPDEST for the footer JUMP switch statement.
 */
export const getExpectedFooterSwitchStatementJumpdestIndex = (
  bytecode: EVMBytecode
): number => {
  let length: number = 0
  for (const opcodeAndBytes of bytecode) {
    if (opcodeAndBytes.opcode === Opcode.JUMP) {
      length += getJumpReplacementBytecodeLength()
    } else if (opcodeAndBytes.opcode === Opcode.JUMPI) {
      length += getJumpiReplacementBytecodeLength()
    } else {
      length += 1 + opcodeAndBytes.opcode.programBytesConsumed
    }
  }
  length += bytecodeToBuffer(getJumpdestMatchSuccessBytecode()).length
  return length
}
