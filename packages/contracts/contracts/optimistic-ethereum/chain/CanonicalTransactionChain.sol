pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

/* Internal Imports */
import { DataTypes } from "../utils/DataTypes.sol";
import { RollupMerkleUtils } from "../utils/RollupMerkleUtils.sol";
import { L1ToL2TransactionQueue } from "../queue/L1ToL2TransactionQueue.sol";
import { SafetyTransactionQueue } from "../queue/SafetyTransactionQueue.sol";

contract CanonicalTransactionChain {
    /*
     * Contract Variables
     */
    address public sequencer;
    uint public forceInclusionPeriod;
    RollupMerkleUtils public merkleUtils;
    L1ToL2TransactionQueue public l1ToL2Queue;
    SafetyTransactionQueue public safetyQueue;
    uint public cumulativeNumElements;
    bytes32[] public batches;
    uint public lastOVMTimestamp;

    /*
     * Events
     */

    event QueueBatchAppended( bytes32 _batchHeaderHash, bytes32 _txHash);
    event SequencerBatchAppended(bytes32 _batchHeaderHash);

    /*
     * Constructor
     */

    constructor(
        address _rollupMerkleUtilsAddress,
        address _sequencer,
        address _l1ToL2TransactionPasserAddress,
        uint _forceInclusionPeriod
    ) public {
        merkleUtils = RollupMerkleUtils(_rollupMerkleUtilsAddress);
        sequencer = _sequencer;
        forceInclusionPeriod = _forceInclusionPeriod;
        lastOVMTimestamp = 0;

        safetyQueue = new SafetyTransactionQueue(address(this));
        l1ToL2Queue = new L1ToL2TransactionQueue(
            _l1ToL2TransactionPasserAddress,
            address(this)
        );
    }

    /*
     * Public Functions
     */

    function getBatchesLength() public view returns (uint) {
       return batches.length;
    }

    function hashBatchHeader(
        DataTypes.TxChainBatchHeader memory _batchHeader
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _batchHeader.timestamp,
            _batchHeader.isL1ToL2Tx,
            _batchHeader.elementsMerkleRoot,
            _batchHeader.numElementsInBatch,
            _batchHeader.cumulativePrevElements
        ));
    }

    function authenticateAppend(
        address _sender
    ) public view returns (bool) {
        return _sender == sequencer;
    }

    function appendL1ToL2Batch() public {
        DataTypes.TimestampedHash memory l1ToL2Header = l1ToL2Queue.peek();

        require(
            safetyQueue.isEmpty() || l1ToL2Header.timestamp <= safetyQueue.peekTimestamp(),
            "Must process older SafetyQueue batches first to enforce timestamp monotonicity"
        );

        l1ToL2Queue.dequeue();
        _appendQueueBatch(l1ToL2Header, true);
    }

    function appendSafetyBatch() public {
        DataTypes.TimestampedHash memory safetyHeader = safetyQueue.peek();

        require(
            l1ToL2Queue.isEmpty() || safetyHeader.timestamp <= l1ToL2Queue.peekTimestamp(),
            "Must process older L1ToL2Queue batches first to enforce timestamp monotonicity"
        );

        safetyQueue.dequeue();
        _appendQueueBatch(safetyHeader, false);
    }

    function _appendQueueBatch(
        DataTypes.TimestampedHash memory timestampedHash,
        bool isL1ToL2Tx
    ) internal {
        uint timestamp = timestampedHash.timestamp;

        require(
            timestamp + forceInclusionPeriod <= now || authenticateAppend(msg.sender),
            "Message sender does not have permission to append this batch"
        );

        lastOVMTimestamp = timestamp;
        bytes32 elementsMerkleRoot = timestampedHash.txHash;
        uint numElementsInBatch = 1;

        bytes32 batchHeaderHash = keccak256(abi.encodePacked(
            timestamp,
            isL1ToL2Tx,
            elementsMerkleRoot,
            numElementsInBatch,
            cumulativeNumElements // cumulativePrevElements
        ));

        batches.push(batchHeaderHash);
        cumulativeNumElements += numElementsInBatch;

        emit QueueBatchAppended(batchHeaderHash, timestampedHash.txHash);
    }

    function appendSequencerBatch(
        bytes[] memory _txBatch,
        uint _timestamp
    ) public {
        require(
            authenticateAppend(msg.sender),
            "Message sender does not have permission to append a batch"
        );

        require(
            _txBatch.length > 0,
            "Cannot submit an empty batch"
        );

        require(
            _timestamp + forceInclusionPeriod > now,
            "Cannot submit a batch with a timestamp older than the sequencer inclusion period"
        );

        require(
            _timestamp <= now,
            "Cannot submit a batch with a timestamp in the future"
        );

        require(
            l1ToL2Queue.isEmpty() || _timestamp <= l1ToL2Queue.peekTimestamp(),
            "Must process older L1ToL2Queue batches first to enforce timestamp monotonicity"
        );

        require(
            safetyQueue.isEmpty() || _timestamp <= safetyQueue.peekTimestamp(),
            "Must process older SafetyQueue batches first to enforce timestamp monotonicity"
        );

        require(
            _timestamp >= lastOVMTimestamp,
            "Timestamps must monotonically increase"
        );

        lastOVMTimestamp = _timestamp;

        bytes32 batchHeaderHash = keccak256(abi.encodePacked(
            _timestamp,
            false, // isL1ToL2Tx
            merkleUtils.getMerkleRoot(_txBatch), // elementsMerkleRoot
            _txBatch.length, // numElementsInBatch
            cumulativeNumElements // cumulativeNumElements
        ));

        batches.push(batchHeaderHash);
        cumulativeNumElements += _txBatch.length;

        emit SequencerBatchAppended(batchHeaderHash);
    }

    // verifies an element is in the current list at the given position
    function verifyElement(
        bytes memory _element, // the element of the list being proven
        uint _position, // the position in the list of the element being proven
        DataTypes.TxElementInclusionProof memory _inclusionProof  // inclusion proof in the rollup batch
    ) public view returns (bool) {
        // For convenience, store the batchHeader
        DataTypes.TxChainBatchHeader memory batchHeader = _inclusionProof.batchHeader;

        // make sure absolute position equivalent to relative positions
        if (_position != _inclusionProof.indexInBatch +
            batchHeader.cumulativePrevElements) {
            return false;
        }

        // verify elementsMerkleRoot
        if (!merkleUtils.verify(
            batchHeader.elementsMerkleRoot,
            _element,
            _inclusionProof.indexInBatch,
            _inclusionProof.siblings
        )) {
            return false;
        }

        //compare computed batch header with the batch header in the list.
        return hashBatchHeader(batchHeader) == batches[_inclusionProof.batchIndex];
    }
}
