import {useCallback, useMemo, useState} from 'react';
import {encodeFunctionData, erc20Abi, erc4626Abi, maxUint256} from 'viem';
import {useReadContract} from 'wagmi';
import {readContract} from '@wagmi/core';

import {isAddress, isEthAddress, toAddress} from '../utils';
import {erc4626RouterAbi} from '../utils/abi/erc4626Router.abi';
import {depositTo4626VaultViaRouter, depositToVault, retrieveConfig, toWagmiProvider} from '../utils/wagmi';
import {toBigInt} from './../utils/format';

import type {Connector} from 'wagmi';
import type {TAddress} from '../types';
import type {TPermitSignature} from './usePermit.types';

type TUseDepositArgsBase = {
	provider: Connector | undefined;
	tokenToDeposit: TAddress;
	vault: TAddress;
	owner: TAddress;
	receiver?: TAddress;
	amountToDeposit: bigint;
	chainID: number;
};

type TUseDepositArgsLegacy = TUseDepositArgsBase & {
	version: 'LEGACY';
	options?: undefined;
};

type TUseDepositArgsERC4626 = TUseDepositArgsBase & {
	version: 'ERC-4626';
	options?: {
		useRouter: boolean;
		routerAddress: TAddress;
		minOutSlippage: bigint;
		permitSignature?: TPermitSignature;
	};
};

type TUseDepositArgs = TUseDepositArgsLegacy | TUseDepositArgsERC4626;

type TUseApproveResp = {
	maxDepositForUser: bigint; // Maximum amount that can be deposited by the user
	expectedOut: bigint; // Expected amount of the token after the deposit
	canDeposit: boolean; // If the token can be deposited`
	isDepositing: boolean; // If the approval is in progress
	onDeposit: (onSuccess?: () => void, onFailure?: () => void) => Promise<void>; // Function to deposit the token
};

export function useVaultDeposit(args: TUseDepositArgs): TUseApproveResp {
	const [isDepositing, set_isDepositing] = useState(false);

	/**********************************************************************************************
	 ** The ERC-4626 version of the vaults has a method called maxDeposit: this function returns
	 ** the maximum amount of underlying assets that can be deposited in a single deposit call by
	 ** the receiver.
	 ** We need this to be able to indicate to the user the maximum amount of tokens that can be
	 ** deposited.
	 *********************************************************************************************/
	const {data: maxDepositForUser, refetch: refetchMaxDepositForUser} = useReadContract({
		address: args.vault,
		abi: erc4626Abi,
		functionName: 'maxDeposit',
		args: [args.owner],
		chainId: args.chainID,
		query: {
			enabled: isAddress(args.owner) && args.version === 'ERC-4626'
		}
	});

	/**********************************************************************************************
	 ** The ERC-4626 version of the vaults has a method called previewDeposit: this function allows
	 ** users to simulate the effects of their deposit at the current block.
	 ** We will used that as an `expectedOut` value.
	 *********************************************************************************************/
	const {data: previewDeposit} = useReadContract({
		address: args.vault,
		abi: erc4626Abi,
		functionName: 'previewDeposit',
		args: [args.amountToDeposit],
		chainId: args.chainID,
		query: {
			enabled: args.version === 'ERC-4626'
		}
	});

	/**********************************************************************************************
	 ** The LEGACY version of the vaults has a method called availableDepositLimit: this function
	 ** returns the maximum amount of underlying assets remaining to be deposited in the vault.
	 ** We need this to be able to indicate to the user the maximum amount of tokens that can be
	 ** deposited.
	 *********************************************************************************************/
	const {data: availableDepositLimit} = useReadContract({
		address: args.tokenToDeposit,
		abi: [
			{
				stateMutability: 'view',
				type: 'function',
				name: 'availableDepositLimit',
				inputs: [],
				outputs: [{name: '', type: 'uint256'}]
			}
		],
		functionName: 'availableDepositLimit',
		args: [],
		chainId: args.chainID,
		query: {
			enabled: args.version === 'LEGACY'
		}
	});

	/**********************************************************************************************
	 ** canDeposit is a boolean that is true if the token can be deposited. It can be deposited if
	 ** the following conditions are met:
	 ** 1. args.tokenToDeposit is a valid address
	 ** 2. args.vault is a valid address
	 ** 3. args.amountToDeposit is greater than 0
	 ** 4. maxDepositForUser is defined and greater than or equal to args.amountToDeposit
	 ** 5. previewDeposit is defined and greater than 0
	 *********************************************************************************************/
	const canDeposit = useMemo(() => {
		if (args.version === 'LEGACY') {
			return Boolean(
				isAddress(args.tokenToDeposit) &&
					isAddress(args.vault) &&
					args.amountToDeposit > 0n &&
					availableDepositLimit &&
					availableDepositLimit >= args.amountToDeposit
			);
		}

		if (isEthAddress(args.tokenToDeposit)) {
			return false;
		}
		if (!isAddress(args.tokenToDeposit) || !isAddress(args.vault)) {
			return false;
		}
		if (args.amountToDeposit <= 0n || args.amountToDeposit > toBigInt(maxDepositForUser)) {
			return false;
		}
		return Boolean(previewDeposit && toBigInt(previewDeposit) > 0n);
	}, [
		args.version,
		args.tokenToDeposit,
		args.vault,
		args.amountToDeposit,
		maxDepositForUser,
		previewDeposit,
		availableDepositLimit
	]);

	/**********************************************************************************************
	 ** onDeposit is a function that is called to deposit the token. It takes two optional
	 ** arguments:
	 ** 1. onSuccess: A function that is called when the approval is successful
	 ** 2. onFailure: A function that is called when the approval fails
	 **
	 ** The function behaves differently based on the options passed in the args, aka if the user
	 ** wants to use a router or not.
	 *********************************************************************************************/
	const onDeposit = useCallback(
		async (onSuccess?: () => void, onFailure?: () => void): Promise<void> => {
			if (!canDeposit) {
				return;
			}

			set_isDepositing(true);
			const wagmiProvider = await toWagmiProvider(args.provider);
			if (!wagmiProvider || !isAddress(wagmiProvider.address)) {
				set_isDepositing(false);
				return;
			}

			/**********************************************************************************************
			 ** If the version is LEGACY, then we can directly deposit the token into the vault. We cannot
			 ** use fancy stuff like permit or router.
			 *********************************************************************************************/
			if (args.version === 'LEGACY') {
				const result = await depositToVault({
					connector: args.provider,
					chainID: args.chainID,
					contractAddress: args.vault,
					receiverAddress: isAddress(args.receiver) ? args.receiver : args.owner,
					amount: args.amountToDeposit
				});
				if (result.isSuccessful) {
					onSuccess?.();
				} else {
					onFailure?.();
				}
				return;
			}

			/**********************************************************************************************
			 ** This flow is specific and used only for the Yearn vaults that are using the ERC-4626 (for
			 ** now). The goal is to be able to perform some non-standard operations like permit or
			 ** depositing via a router.
			 ** Documentation about the router can be found here:
			 ** https://github.com/yearn/Yearn-ERC4626-Router
			 *********************************************************************************************/
			if (args.options) {
				if (args.options.minOutSlippage < 0n || args.options.minOutSlippage > 10000n) {
					throw new Error('Invalid minOutSlippage');
				}
				if (!isAddress(args.options.routerAddress)) {
					throw new Error('Invalid router address');
				}
				const multicalls = [];
				const minShareOut = (toBigInt(previewDeposit) * (10000n - args.options.minOutSlippage)) / 10000n;

				/**********************************************************************************************
				 ** We need to make sure that the Vault can spend the Underlying Token owned by the router.
				 ** This is a bit weird and only need to be done once, but hey, this is required.
				 *********************************************************************************************/
				const allowance = await readContract(retrieveConfig(), {
					address: args.tokenToDeposit,
					chainId: args.chainID,
					abi: erc20Abi,
					functionName: 'allowance',
					args: [args.options.routerAddress, args.vault]
				});
				if (toBigInt(allowance) < maxUint256) {
					multicalls.push(
						encodeFunctionData({
							abi: erc4626RouterAbi,
							functionName: 'approve',
							args: [args.tokenToDeposit, args.vault, maxUint256]
						})
					);
				}

				/**********************************************************************************************
				 ** Then we can prepare our multicall
				 *********************************************************************************************/
				if (args.options.permitSignature) {
					multicalls.push(
						encodeFunctionData({
							abi: erc4626RouterAbi,
							functionName: 'selfPermit',
							args: [
								toAddress(args.tokenToDeposit),
								toBigInt(args.amountToDeposit),
								args.options.permitSignature.deadline,
								args.options.permitSignature.v,
								args.options.permitSignature.r,
								args.options.permitSignature.s
							]
						})
					);
				}
				multicalls.push(
					encodeFunctionData({
						abi: erc4626RouterAbi,
						functionName: 'depositToVault',
						args: [args.vault, args.amountToDeposit, wagmiProvider.address, minShareOut]
					})
				);
				const result = await depositTo4626VaultViaRouter({
					connector: args.provider,
					chainID: args.chainID,
					contractAddress: args.options.routerAddress,
					multicalls
				});
				if (result.isSuccessful) {
					onSuccess?.();
				} else {
					onFailure?.();
				}
			} else {
				const result = await depositToVault({
					connector: args.provider,
					chainID: args.chainID,
					contractAddress: args.vault,
					receiverAddress: isAddress(args.receiver) ? args.receiver : args.owner,
					amount: args.amountToDeposit
				});
				if (result.isSuccessful) {
					onSuccess?.();
				} else {
					onFailure?.();
				}
			}

			await refetchMaxDepositForUser();
			set_isDepositing(false);
		},
		[
			args.amountToDeposit,
			args.chainID,
			args.options,
			args.owner,
			args.provider,
			args.receiver,
			args.tokenToDeposit,
			args.vault,
			args.version,
			canDeposit,
			previewDeposit,
			refetchMaxDepositForUser
		]
	);

	return {
		maxDepositForUser: toBigInt(maxDepositForUser),
		expectedOut: toBigInt(previewDeposit),
		canDeposit,
		isDepositing,
		onDeposit
	};
}
