// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import { ERC721Bridge } from "../universal/op-erc721/ERC721Bridge.sol";
import { ERC165Checker } from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import { L1ERC721Bridge } from "../L1/L1ERC721Bridge.sol";
import { IOptimismMintableERC721 } from "../universal/op-erc721/IOptimismMintableERC721.sol";
import { Semver } from "@eth-optimism/contracts-bedrock/contracts/universal/Semver.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title L2ERC721Bridge
 * @notice The L2 ERC721 bridge is a contract which works together with the L1 ERC721 bridge to
 *         make it possible to transfer ERC721 tokens between Optimism and Ethereum. This contract
 *         acts as a minter for new tokens when it hears about deposits into the L1 ERC721 bridge.
 *         This contract also acts as a burner for tokens being withdrawn.
 */
contract L2ERC721Bridge is ERC721Bridge, Semver {
    /**
     * @custom:semver 0.0.1
     *
     * @param _messenger   Address of the CrossDomainMessenger on this network.
     * @param _otherBridge Address of the ERC721 bridge on the other network.
     */
    constructor(address _messenger, address _otherBridge)
        Semver(0, 0, 1)
        ERC721Bridge(_messenger, _otherBridge)
    {}

    /**
     * @notice Completes an ERC721 bridge from the other domain and sends the ERC721 token to the
     *         recipient on this domain.
     *
     * @param _localToken  Address of the ERC721 token on this domain.
     * @param _remoteToken Address of the ERC721 token on the other domain.
     * @param _from        Address that triggered the bridge on the other domain.
     * @param _to          Address to receive the token on this domain.
     * @param _tokenId     ID of the token being deposited.
     * @param _extraData   Optional data to forward to L1. Data supplied here will not be used to
     *                     execute any code on L1 and is only emitted as extra data for the
     *                     convenience of off-chain tooling.
     */
    function finalizeBridgeERC721(
        address _localToken,
        address _remoteToken,
        address _from,
        address _to,
        uint256 _tokenId,
        bytes calldata _extraData
    ) external onlyOtherBridge {
        // Check the target token is compliant and verify the deposited token on L1 matches the L2
        // deposited token representation.
        if (
            // slither-disable-next-line reentrancy-events
            ERC165Checker.supportsInterface(
                _localToken,
                type(IOptimismMintableERC721).interfaceId
            ) && _remoteToken == IOptimismMintableERC721(_localToken).remoteToken()
        ) {
            // When a deposit is finalized, we give the NFT with the same tokenId to the account
            // on L2.
            // slither-disable-next-line reentrancy-events
            IOptimismMintableERC721(_localToken).mint(_to, _tokenId);
            // slither-disable-next-line reentrancy-events
            emit ERC721BridgeFinalized(_localToken, _remoteToken, _from, _to, _tokenId, _extraData);
        } else {
            // Either the L2 token which is being deposited-into disagrees about the correct address
            // of its L1 token, or does not support the correct interface.
            // This should only happen if there is a  malicious L2 token, or if a user somehow
            // specified the wrong L2 token address to deposit into.
            // In either case, we stop the process here and construct a withdrawal
            // message so that users can get their NFT out in some cases.
            // There is no way to prevent malicious token contracts altogether, but this does limit
            // user error and mitigate some forms of malicious contract behavior.
            bytes memory message = abi.encodeWithSelector(
                L1ERC721Bridge.finalizeBridgeERC721.selector,
                _remoteToken,
                _localToken,
                _to, // switched the _to and _from here to bounce back the deposit to the sender
                _from,
                _tokenId,
                _extraData
            );

            // Send message up to L1 bridge
            // slither-disable-next-line reentrancy-events
            messenger.sendMessage(otherBridge, message, 0);

            // slither-disable-next-line reentrancy-events
            emit ERC721BridgeFailed(_localToken, _remoteToken, _from, _to, _tokenId, _extraData);
        }
    }

    /**
     * @inheritdoc ERC721Bridge
     */
    function _initiateBridgeERC721(
        address _localToken,
        address _remoteToken,
        address _from,
        address _to,
        uint256 _tokenId,
        uint32 _minGasLimit,
        bytes calldata _extraData
    ) internal override {
        // Check that the withdrawal is being initiated by the NFT owner
        require(
            _from == IOptimismMintableERC721(_localToken).ownerOf(_tokenId),
            "Withdrawal is not being initiated by NFT owner"
        );

        // Construct calldata for l1ERC721Bridge.finalizeBridgeERC721(_to, _tokenId)
        // slither-disable-next-line reentrancy-events
        address remoteToken = IOptimismMintableERC721(_localToken).remoteToken();
        require(
            remoteToken == _remoteToken,
            "L2ERC721Bridge: remote token does not match given value"
        );

        // When a withdrawal is initiated, we burn the withdrawer's NFT to prevent subsequent L2
        // usage
        // slither-disable-next-line reentrancy-events
        IOptimismMintableERC721(_localToken).burn(_from, _tokenId);

        bytes memory message = abi.encodeWithSelector(
            L1ERC721Bridge.finalizeBridgeERC721.selector,
            remoteToken,
            _localToken,
            _from,
            _to,
            _tokenId,
            _extraData
        );

        // Send message to L1 bridge
        // slither-disable-next-line reentrancy-events
        messenger.sendMessage(otherBridge, message, _minGasLimit);

        // slither-disable-next-line reentrancy-events
        emit ERC721BridgeInitiated(_localToken, remoteToken, _from, _to, _tokenId, _extraData);
    }
}
