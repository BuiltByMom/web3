import {useCallback, useMemo, useState} from 'react';
import {erc4626Abi} from 'viem';
import {useReadContract} from 'wagmi';
import {readContracts} from '@wagmi/core';

import {useWeb3} from '../contexts/useWeb3';
import {decodeAsBigInt, isAddress, isEthAddress} from '../utils';
import {vaultAbi} from '../utils/abi/vaultV2.abi';
import {toBigInt} from '../utils/format';
import {retrieveConfig, toWagmiProvider, withdrawFrom4626Vault, withdrawFromVault} from '../utils/wagmi';

import type {TAddress} from '../types';

type TUseWithdrawArgsBase = {
	tokenToWithdraw: TAddress;
	vault: TAddress;
	owner: TAddress;
	receiver?: TAddress;
	amountToWithdraw: bigint;
	chainID: number;
};

type TUseWithdrawArgsLegacy = TUseWithdrawArgsBase & {
	version: 'LEGACY';
	minOutSlippage?: undefined;
	redeemTolerance?: undefined;
};

type TUseWithdrawArgsERC4626 = TUseWithdrawArgsBase & {
	version: 'ERC-4626';
	minOutSlippage: bigint;
	redeemTolerance: bigint;
};

type TUseWithdrawArgs = TUseWithdrawArgsLegacy | TUseWithdrawArgsERC4626;

type TUseWithdrawResp = {
	maxWithdrawForUser: bigint; // Maximum amount that can be withdrawn by the user
	expectedOut: bigint; // Expected amount of the token after the deposit
	canWithdraw: boolean; // If the token can be withdrawn
	isWithdrawing: boolean; // If the approval is in progress
	onWithdraw: (onSuccess?: () => void, onFailure?: () => void) => Promise<boolean>; // Function to withdraw the token
};

export function useVaultWithdraw(args: TUseWithdrawArgs): TUseWithdrawResp {
	const {provider} = useWeb3();
	const [isWithdrawing, set_isWithdrawing] = useState(false);

	/**********************************************************************************************
	 ** The ERC-4626 version of the vaults has a method called maxWithdraw: this function returns
	 ** the maximum amount of underlying assets that can be withdrawn in a single withdraw call by
	 ** the receiver.
	 ** We need this to be able to indicate to the user the maximum amount of tokens that can be
	 ** withdrawn.
	 *********************************************************************************************/
	const {data: maxWithdrawForUser, refetch: refetchMaxWithdrawForUser} = useReadContract({
		address: args.vault,
		abi: erc4626Abi,
		functionName: 'maxWithdraw',
		args: [args.owner],
		chainId: args.chainID,
		query: {
			enabled: isAddress(args.owner) && args.version === 'ERC-4626'
		}
	});

	/**********************************************************************************************
	 ** The ERC-4626 version of the vaults has a method called previewWithdraw: this function allows
	 ** users to simulate the effects of their withdraw at the current block.
	 ** We will used that as an `expectedOut` value.
	 *********************************************************************************************/
	const {data: previewWithdraw} = useReadContract({
		address: args.vault,
		abi: erc4626Abi,
		functionName: 'previewWithdraw',
		args: [args.amountToWithdraw],
		chainId: args.chainID,
		query: {
			enabled: args.version === 'ERC-4626'
		}
	});

	/**********************************************************************************************
	 ** The LEGACY version of the vaults no way to preview the withdraw, so we will use the PPS
	 ** value to simulate the effects of the withdraw.
	 *********************************************************************************************/
	const {data: pricePerShare} = useReadContract({
		address: args.vault,
		abi: vaultAbi,
		functionName: 'pricePerShare',
		args: [],
		chainId: args.chainID,
		query: {
			enabled: args.version === 'LEGACY'
		}
	});

	/**********************************************************************************************
	 ** For the LEGACY version of the vaults, we need to know the decimals to adjust the PPS value
	 *********************************************************************************************/
	const {data: decimals} = useReadContract({
		address: args.vault,
		abi: vaultAbi,
		functionName: 'decimals',
		args: [],
		chainId: args.chainID,
		query: {
			enabled: args.version === 'LEGACY'
		}
	});

	/**********************************************************************************************
	 ** expectedOut is the expected amount of the token after the deposit. It is calculated based
	 ** on the price per share for the LEGACY version of the vaults and the previewWithdraw for the
	 ** ERC-4626 version of the vaults.
	 *********************************************************************************************/
	const expectedOut = useMemo(() => {
		if (args.version === 'LEGACY') {
			return (toBigInt(pricePerShare) * args.amountToWithdraw) / 10n ** toBigInt(decimals);
		}

		return toBigInt(previewWithdraw);
	}, [args.version, args.amountToWithdraw, previewWithdraw, pricePerShare, decimals]);

	/**********************************************************************************************
	 ** canWithdraw is a boolean that is true if the token can be withdrawn. It can be withdrawn if
	 ** the following conditions are met:
	 ** 1. args.tokenToWithdraw is a valid address
	 ** 2. args.vault is a valid address
	 ** 3. args.amountToWithdraw is greater than 0
	 ** 4. maxWithdrawForUser is defined and greater than or equal to args.amountToWithdraw
	 ** 5. previewWithdraw is defined and greater than 0
	 *********************************************************************************************/
	const canWithdraw = useMemo(() => {
		if (args.version === 'LEGACY') {
			return Boolean(isAddress(args.tokenToWithdraw) && isAddress(args.vault) && args.amountToWithdraw > 0n);
		}

		if (isEthAddress(args.tokenToWithdraw)) {
			return false;
		}
		if (!isAddress(args.tokenToWithdraw) || !isAddress(args.vault)) {
			return false;
		}
		if (args.amountToWithdraw <= 0n || args.amountToWithdraw > toBigInt(maxWithdrawForUser)) {
			return false;
		}
		return Boolean(previewWithdraw && toBigInt(previewWithdraw) > 0n);
	}, [args.version, args.tokenToWithdraw, args.vault, args.amountToWithdraw, maxWithdrawForUser, previewWithdraw]);

	/**********************************************************************************************
	 ** onWithdraw is a function that is called to deposit the token. It takes two optional
	 ** arguments:
	 ** 1. onSuccess: A function that is called when the approval is successful
	 ** 2. onFailure: A function that is called when the approval fails
	 **
	 ** The function behaves differently based on the options passed in the args, aka if the user
	 ** wants to use a router or not.
	 *********************************************************************************************/
	const onWithdraw = useCallback(
		async (onSuccess?: () => void, onFailure?: () => void): Promise<boolean> => {
			if (!canWithdraw) {
				return false;
			}
			set_isWithdrawing(true);

			const wagmiProvider = await toWagmiProvider(provider);
			if (!wagmiProvider || !isAddress(wagmiProvider.address)) {
				set_isWithdrawing(false);
				return false;
			}

			/**********************************************************************************************
			 ** If the version is LEGACY, then we can directly deposit the token into the vault. We cannot
			 ** use fancy stuff like permit or router.
			 *********************************************************************************************/
			if (args.version === 'LEGACY') {
				const result = await withdrawFromVault({
					connector: provider,
					chainID: args.chainID,
					contractAddress: args.vault,
					receiver: isAddress(args.receiver) ? args.receiver : args.owner,
					amount: args.amountToWithdraw
				});
				if (result.isSuccessful) {
					onSuccess?.();
				} else {
					onFailure?.();
				}
				return result.isSuccessful;
			}

			/**********************************************************************************************
			 ** If we are going with the ERC-4626 version of the vaults, then we can use either the redeem
			 ** or the withdraw function.
			 *********************************************************************************************/
			if (args.minOutSlippage < 0n || args.minOutSlippage > 10000n) {
				throw new Error('Invalid minOutSlippage');
			}
			if (args.redeemTolerance < 0n || args.redeemTolerance > 10000n) {
				throw new Error('Invalid minOutSlippage');
			}

			/**********************************************************************************************
			 ** The user is inputing an amount of TOKEN he wants to get back. The SC has two different
			 ** method to withdraw funds:
			 ** Withdraw -> Tell me the amount of TOKEN you wanna take out
			 ** Redeem -> Tell me the amount of shares you wanna take out
			 ** Usually, we want to call redeem with the number of shares as this is the "safest" one.
			 ** However, as we are asking the user to input the amount of TOKEN he wants to get back, we
			 ** will need to do a little gymnastic to get the number of shares to redeem:
			 ** - First we need to check the amount the user inputed is valid.
			 ** - Then, we will query the SC to get the current share corresponding to the amount of TOKEN
			 **   the user wants to get back.
			 ** - We will do the same to know how many shares the user has.
			 ** - We would like to call `redeem` if the TOKEN -> share value correspond to the balance
			 **   of the user. (1 dai -> 1.1 share, user has 1.1 share, he wants to get 1 dai back, so
			 **   we can call redeem with the number of shares)
			 ** - However, between the moment the user clicks on the button and the moment the transaction
			 **   is executed, the price per share might have evolved, and some dust might be lost in
			 **   translation.
			 ** - To avoid this, we will add a slippage tolerance to the amount of TOKEN the user wants to
			 **   get back. If the price per share has evolved, we will still be able to call redeem.
			 ** - Otherwise, we will call withdraw with the amount of tokens the user wants to get back.
			 *********************************************************************************************/
			const [_convertToShare, _availableShares] = await readContracts(retrieveConfig(), {
				contracts: [
					{
						address: args.vault,
						chainId: args.chainID,
						abi: erc4626Abi,
						functionName: 'convertToShares',
						args: [args.amountToWithdraw]
					},
					{
						address: args.vault,
						chainId: args.chainID,
						abi: erc4626Abi,
						functionName: 'balanceOf',
						args: [wagmiProvider.address]
					}
				]
			});

			/**********************************************************************************************
			 ** At this point:
			 ** - decodeAsBigInt(convertToShare) -> Amount of shares the user asked to get back
			 ** - decodeAsBigInt(availableShares) -> Amount of shares the user has
			 ** - tolerance -> 1% of the balance
			 *********************************************************************************************/
			const convertToShare = decodeAsBigInt(_convertToShare);
			const availableShares = decodeAsBigInt(_availableShares);
			const tolerance = (availableShares * args.redeemTolerance) / 10000n; // X% of the balance
			const isAskingToWithdrawAll = availableShares - convertToShare < tolerance;

			const result = await withdrawFrom4626Vault({
				connector: provider,
				chainID: args.chainID,
				contractAddress: args.vault,
				amount: isAskingToWithdrawAll ? availableShares : args.amountToWithdraw,
				maxLoss: args.minOutSlippage,
				receiver: isAddress(args.receiver) ? args.receiver : args.owner,
				owner: args.owner,
				shouldUseRedeem: isAskingToWithdrawAll
			});
			if (result.isSuccessful) {
				onSuccess?.();
			} else {
				onFailure?.();
			}
			await refetchMaxWithdrawForUser();
			set_isWithdrawing(false);
			return result.isSuccessful;
		},
		[
			canWithdraw,
			args.version,
			args.minOutSlippage,
			args.redeemTolerance,
			args.vault,
			args.chainID,
			args.amountToWithdraw,
			args.receiver,
			args.owner,
			provider,
			refetchMaxWithdrawForUser
		]
	);

	return {
		maxWithdrawForUser: toBigInt(maxWithdrawForUser),
		expectedOut: toBigInt(expectedOut),
		canWithdraw,
		isWithdrawing,
		onWithdraw
	};
}
