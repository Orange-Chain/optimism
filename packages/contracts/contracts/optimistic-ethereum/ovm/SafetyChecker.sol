pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

/**
 * @title SafetyChecker
 * @notice Safety Checker contract used to check whether or not bytecode is
 *         safe, meaning:
 *              1. It uses only whitelisted opcodes.
 *              2. All CALLs are to the Execution Manager and have no value.
 */
contract SafetyChecker {
    uint256 public opcodeWhitelistMask;
    address public executionManagerAddress;

    /**
     * @notice Create a new Safety Checker with the specified whitelist mask.
     * @param _opcodeWhitelistMask A hex number of 256 bits where each bit
     *                             represents an opcode, 0 - 255, which is set
     *                             if whitelisted and unset otherwise.
     * @param _executionManagerAddress Execution manager contract address.
     */
    constructor(uint256 _opcodeWhitelistMask, address _executionManagerAddress) public {
        opcodeWhitelistMask = _opcodeWhitelistMask;
        executionManagerAddress = _executionManagerAddress;
    }

    /**
     * @notice Converts the 20 bytes at _start of _bytes into an address.
     * @param _bytes The bytes to extract the address from.
     * @param _start The start index from which to extract the address from
     *               (e.g. 0 if _bytes starts with the address).
     * @return Bytes converted to an address.
     */
    function toAddress(
        bytes memory _bytes,
        uint256 _start
    ) internal pure returns (address addr) {
        require(_bytes.length >= (_start + 20), "Addresses must be at least 20 bytes");

        assembly {
            addr := mload(add(add(_bytes, 20), _start))
        }
    }

    /**
     * @notice Returns whether or not all of the provided bytecode is safe.
     * @dev More info on creation vs. runtime bytecode:
     * https://medium.com/authereum/bytecode-and-init-code-and-runtime-code-oh-my-7bcd89065904.
     * @param _bytecode The bytecode to safety check. This can be either
     *                  creation bytecode (aka initcode) or runtime bytecode
     *                  (aka cont
     * More info on creation vs. runtime bytecode:
     * https://medium.com/authereum/bytecode-and-init-code-and-runtime-code-oh-my-7bcd89065904ract code).
     * @return `true` if the bytecode is safe, `false` otherwise.
     */
    function isBytecodeSafe(
        bytes memory _bytecode
    ) public view returns (bool) {
        bool seenJUMP = false;
        bool insideUnreachableCode = false;
        uint256[] memory ops = new uint256[](_bytecode.length);
        uint256 opIndex = 0;
        for (uint256 pc = 0; pc < _bytecode.length; pc++) {
            // current opcode: 0x00...0xff
            uint256 op = uint8(_bytecode[pc]);

            // PUSH##
            if (op >= 0x60 && op <= 0x7f) {
                // subsequent bytes are not opcodes. Skip them.
                pc += (op - 0x5f);
            }
            // If we're in between a STOP or REVERT or JUMP and a JUMPDEST
            if (insideUnreachableCode) {
                // JUMPDEST
                if (op == 0x5b) {
                    // this bytecode is now reachable via JUMP or JUMPI
                    insideUnreachableCode = false;
                }
            } else {
                // check that opcode is whitelisted (using the whitelist bit mask)
                uint256 opBit = 2 ** op;
                if (opcodeWhitelistMask & opBit != opBit) {
                    // encountered a non-whitelisted opcode!
                    return false;
                }
                // append this opcode to a list of ops
                ops[opIndex] = op;
                // JUMPI
                if (op == 0x57) {
                    // We can now reach all JUMPDESTs
                    seenJUMP = true;
                // JUMP
                } else if (op == 0x56) {
                    // We can now reach all JUMPDESTs
                    seenJUMP = true;
                    // we are now inside unreachable code until we hit a JUMPDEST!
                    insideUnreachableCode = true;
                // STOP or REVERT or INVALID or RETURN (see safety checker docs in wiki for more info)
                } else if (op == 0x00 || op == 0xfd || op == 0xfe || op == 0xf3) {
                    // If we can't jump to JUMPDESTs, then all remaining bytecode is unreachable
                    if (!seenJUMP) {
                        return true;
                    }
                    // We are now inside unreachable code until we hit a JUMPDEST!
                    insideUnreachableCode = true;
                // CALL
                } else if (op == 0xf1) {
                    // Minimum 4 total ops:
                    // 1. PUSH1 value
                    // 2. PUSH20 execution manager address
                    // 3. PUSH or DUP gas
                    // 4. CALL

                    if (opIndex < 3) {
                        return false;
                    }
                    uint256 gasOp = ops[opIndex - 1];
                    uint256 addressOp = ops[opIndex - 2];
                    uint256 valueOp = ops[opIndex - 3];
                    if (
                        gasOp < 0x60 || // PUSHes are 0x60...0x7f
                        gasOp > 0x8f || // DUPs are 0x80...0x8f
                        addressOp != 0x73 || // address must be set with a PUSH20
                        valueOp != 0x60 // value must be set with a PUSH1
                    ) {
                        return false;
                    } else {
                        uint256 pushedBytes;
                        // gas is set with a PUSH##
                        if (gasOp >= 0x60 && gasOp <= 0x7f) {
                            pushedBytes = gasOp - 0x5f;
                        }

                        // 23 is from 1 + PUSH20 + 20 bytes of address + PUSH or DUP gas
                        byte callValue = _bytecode[pc - (23 + pushedBytes)];

                        // 21 is from 1 + 19 bytes of address + PUSH or DUP gas
                        address callAddress = toAddress(_bytecode, (pc - (21 + pushedBytes)));

                        // CALL is made to the execution manager with msg.value of 0 ETH
                        if (callAddress != executionManagerAddress || callValue != 0 ) {
                            return false;
                        }
                    }
                }
                opIndex++;
            }
        }
        return true;
    }
}
