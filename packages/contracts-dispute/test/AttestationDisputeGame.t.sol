// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "forge-std/Test.sol";

import "src/types/Errors.sol";
import "src/types/Types.sol";

import { LibClock } from "src/lib/LibClock.sol";
import { LibHashing } from "src/lib/LibHashing.sol";
import { LibPosition } from "src/lib/LibPosition.sol";

import { ResourceMetering } from "contracts-bedrock/L1/ResourceMetering.sol";
import { SystemConfig } from "contracts-bedrock/L1/SystemConfig.sol";
import { L2OutputOracle } from "contracts-bedrock/L1/L2OutputOracle.sol";

import { AttestationDisputeGame } from "src/AttestationDisputeGame.sol";
import { IDisputeGameFactory } from "src/interfaces/IDisputeGameFactory.sol";
import { IDisputeGame } from "src/interfaces/IDisputeGame.sol";
import { IBondManager } from "src/interfaces/IBondManager.sol";
import { BondManager } from "src/BondManager.sol";
import { DisputeGameFactory } from "src/DisputeGameFactory.sol";

/// @title AttestationDisputeGame_Test
contract AttestationDisputeGame_Test is Test {
    bytes32 constant TYPE_HASH = 0x2676994b0652bcdf7968635d15b78aac9aaf797cc94c5adeb94376cc28f987d6;

    DisputeGameFactory factory;
    BondManager bm;
    AttestationDisputeGame disputeGameImplementation;
    SystemConfig systemConfig;
    L2OutputOracle l2oo;
    AttestationDisputeGame disputeGameProxy;

    // L2OutputOracle Constructor arguments
    address internal proposer = 0x000000000000000000000000000000000000AbBa;
    address internal owner = 0x000000000000000000000000000000000000ACDC;
    uint256 internal submissionInterval = 1800;
    uint256 internal l2BlockTime = 1;
    uint256 internal startingBlockNumber = 200;
    uint256 internal startingTimestamp = 2;

    // SystemConfig `signerSet` keys
    uint256[] signerKeys;

    /// @notice Emitted when a new dispute game is created by the [DisputeGameFactory]
    event DisputeGameCreated(address indexed disputeProxy, GameType indexed gameType, Claim indexed rootClaim);

    function setUp() public {
        // vm.warp(startingTimestamp);

        factory = new DisputeGameFactory(address(this));
        vm.label(address(factory), "DisputeGameFactory");
        bm = new BondManager(factory);
        vm.label(address(bm), "BondManager");

        ResourceMetering.ResourceConfig memory _config = ResourceMetering.ResourceConfig({
            maxResourceLimit: 1000000000,
            elasticityMultiplier: 2,
            baseFeeMaxChangeDenominator: 2,
            minimumBaseFee: 10,
            systemTxMaxGas: 100000000,
            maximumBaseFee: 1000
        });

        systemConfig = new SystemConfig(
            address(this), // _owner,
            100, // _overhead,
            100, // _scalar,
            keccak256("BATCHER.HASH"), // _batcherHash,
            type(uint64).max, // _gasLimit,
            address(0), // _unsafeBlockSigner,
            _config
        );
        vm.label(address(systemConfig), "SystemConfig");

        // Add 5 signers to the signer set
        for (uint256 i = 1; i < 6; i++) {
            signerKeys.push(i);
            systemConfig.authenticateSigner(vm.addr(i), true);
        }
        systemConfig.setSignatureThreshold(5);

        l2oo = new L2OutputOracle({
            _l2BlockTime: l2BlockTime,
            _startingBlockNumber: startingBlockNumber,
            _startingTimestamp: block.timestamp,
            _finalizationPeriodSeconds: 7 days,
            _bondManager: IBondManager(address(bm)),
            _disputeGameFactory: IDisputeGameFactory(address(factory))
        });
        vm.label(address(l2oo), "L2OutputOracle");

        // Create the dispute game implementation
        disputeGameImplementation = new AttestationDisputeGame(IBondManager(address(bm)), systemConfig, l2oo);
        vm.label(address(disputeGameImplementation), "AttestationDisputeGame_Implementation");

        // Set the implementation in the factory
        GameType gt = GameType.ATTESTATION;
        factory.setImplementation(gt, IDisputeGame(address(disputeGameImplementation)));

        // Create the attestation dispute game in the factory
        bytes memory extraData = hex"";
        Claim rootClaim = Claim.wrap(bytes32(0));
        vm.expectEmit(false, true, true, false);
        emit DisputeGameCreated(address(0), gt, rootClaim);
        disputeGameProxy = AttestationDisputeGame(address(factory.create(gt, rootClaim, extraData)));
        assertEq(address(factory.games(gt, rootClaim, extraData)), address(disputeGameProxy));
        vm.label(address(disputeGameProxy), "AttestationDisputeGame_Proxy");
    }

    ////////////////////////////////////////////////////////////////
    //                      INIT STATE TESTS                      //
    ////////////////////////////////////////////////////////////////

    /// @dev Tests that, upon initialization, the game status is set to `IN_PROGRESS`
    function test_initGameStatus_succeeds() public {
        assertEq(uint8(disputeGameProxy.status()), uint8(GameStatus.IN_PROGRESS));
    }

    /// @dev Tests that the game type was properly set to ATTESTATION
    function test_gameType_succeeds() public {
        assertEq(uint8(disputeGameProxy.gameType()), uint8(GameType.ATTESTATION));
    }

    /// @dev Tests that the version was properly set to "0.0.1"
    function test_version_succeeds() public {
        assertEq(disputeGameProxy.version(), "0.0.1");
    }

    /// @dev Tests that the dispute type hash was properly configured.
    ///      The intended preimage is "Dispute(bytes32 outputRoot,uint256 l2BlockNumber)"
    function test_disputeTypeHash_succeeds() public {
        assertEq(Hash.unwrap(disputeGameProxy.DISPUTE_TYPE_HASH()), TYPE_HASH);
    }

    /// @dev Tests that the dispute game implementation properly forwards the
    ///      signature threshold call to the `SystemConfig`
    /// TODO: Should we freeze the signature threshold along with the signer set?
    function test_signatureThreshold_succeeds() public {
        assertEq(disputeGameProxy.frozenSignatureThreshold(), systemConfig.signatureThreshold());
    }

    /// @dev Tests that the default initialization set the proper values.
    function test_defaultInitialization_succeeds() public {
        // Assert that the L2OO was properly set
        assertEq(address(disputeGameProxy.l2OutputOracle()), address(l2oo));

        // Assert that the system config was properly set
        assertEq(address(disputeGameProxy.systemConfig()), address(systemConfig));

        // Assert that the bond manager was properly set
        IBondManager _bondManager = disputeGameProxy.bondManager();
        assertEq(address(_bondManager), address(bm));

        // Assert that the signer set was copied over from the `SystemConfig`
        uint256 frozenSetLength = uint256(vm.load(address(disputeGameProxy), bytes32(uint256(2))));
        address[] memory frozenSet = new address[](frozenSetLength);
        for (uint256 i = 0; i < frozenSetLength; i++) {
            frozenSet[i] = disputeGameProxy.frozenSignerSet(i);
        }
        assertEq(frozenSet, systemConfig.signerSet());

        // Assert that the signature threshold was copied over from the `SystemConfig`
        assertEq(disputeGameProxy.frozenSignatureThreshold(), systemConfig.signatureThreshold());
    }

    ////////////////////////////////////////////////////////////////
    //                      SIGNER SET TESTS                      //
    ////////////////////////////////////////////////////////////////

    /// @dev Redundant test to show that changing the `SystemConfig`'s signer set should
    ///      *not* change the frozen signer set of the `AttestationDisputeGame`.
    function test_changeSignerSet_staysFrozen_succeeds() public {
        // Add 5 more signers to the signer set
        for (uint256 i = 6; i < 11; i++) {
            systemConfig.authenticateSigner(vm.addr(i), true);
        }

        // Grab the length of the frozen signer set from the `AttestationDisputeGame`
        // The frozen signer set is stored at slot 2 in the `AttestationDisputeGame` storage
        uint256 frozenLength = uint256(vm.load(address(disputeGameProxy), bytes32(uint256(2))));
        // Grab the length of the canonical signer set from the `SystemConfig`
        uint256 sysConfigLength = systemConfig.signerSet().length;

        // Assert that the frozen signer set length is 5 and the signer set length is 10
        assertEq(frozenLength, 5);
        assertEq(sysConfigLength, 10);
    }

    /// @dev Tests that after changing the signer set in the `SystemConfig`, the signer
    ///      set of all new `AttestationDisputeGame`s reflect these changes.
    function test_changeSignerSet_newGame_succeeds() public {
        // Add 5 more signers to the signer set and ensure that the current game's
        // signer set remains static.
        test_changeSignerSet_staysFrozen_succeeds();

        // Create a new attestation dispute game.
        AttestationDisputeGame newGame = AttestationDisputeGame(
            address(factory.create(GameType.ATTESTATION, Claim.wrap(bytes32(0)), abi.encode(20)))
        );

        // Grab the length of the frozen signer set from the new `AttestationDisputeGame`
        uint256 frozenLength = uint256(vm.load(address(newGame), bytes32(uint256(2))));
        // Grab the length of the canonical signer set from the `SystemConfig`.
        uint256 sysConfigLength = systemConfig.signerSet().length;

        // Assert that the frozen signer set length for the new is 10 and the signer set length is 10
        assertEq(frozenLength, sysConfigLength);
    }

    /// @dev Redundant test to show that changing the `SystemConfig`'s sig threshold should
    ///      *not* change the sig threshold of the `AttestationDisputeGame`.
    function test_changeSigThreshold_staysFrozen_succeeds() public {
        // Update the signature threshold in the system configuration
        systemConfig.setSignatureThreshold(6);

        // Assert that the frozen signature threshold is still 5
        assertEq(disputeGameProxy.frozenSignatureThreshold(), 5);
        // Assert that the canonical signature threshold is 6 after the update
        assertEq(systemConfig.signatureThreshold(), 6);
    }

    /// @dev Tests that after changing the sig threshold in the `SystemConfig`, the sig threshold
    ///      set of all new `AttestationDisputeGame`s reflect these changes.
    function test_changeSigThreshold_newGame_succeeds() public {
        // Change the signature threshold in the `SystemConfig`
        test_changeSigThreshold_staysFrozen_succeeds();

        // Create a new attestation dispute game.
        AttestationDisputeGame newGame = AttestationDisputeGame(
            address(factory.create(GameType.ATTESTATION, Claim.wrap(bytes32(0)), abi.encode(20)))
        );

        // Assert that the canonical signature threshold is 6 after the update
        assertEq(systemConfig.signatureThreshold(), 6);
        // Assert that the new game's signature threshold is 6.
        assertEq(newGame.frozenSignatureThreshold(), systemConfig.signatureThreshold());
    }
}
