'use client';

import {createContext, memo, useCallback, useContext, useMemo} from 'react';
import {useDeepCompareMemo, useLocalStorageValue} from '@react-hookz/web';

import {useWeb3} from '../contexts/useWeb3';
import {useAsyncTrigger} from '../hooks/useAsyncTrigger';
import {useBalances} from '../hooks/useBalances.multichains';
import {useChainID} from '../hooks/useChainID';
import {DEFAULT_ERC20, ETH_TOKEN_ADDRESS, isZeroAddress, toAddress, zeroNormalizedBN} from '../utils';
import {getNetwork} from '../utils/wagmi/utils';
import {toTokenListToken, toTToken, useTokenList} from './WithTokenList';

import type {ReactElement} from 'react';
import type {TUseBalancesTokens} from '../hooks/useBalances.multichains';
import type {TAddress, TChainTokens, TDict, TNormalizedBN, TToken, TTokenList} from '../types';

type TTokenAndChain = {address: TAddress; chainID: number};
type TWalletContext = {
	getToken: ({address, chainID}: TTokenAndChain) => TToken;
	getBalance: ({address, chainID}: TTokenAndChain) => TNormalizedBN;
	balances: TChainTokens;
	isLoading: boolean;
	onRefresh: (tokenList?: TUseBalancesTokens[]) => Promise<TChainTokens>;
	onRefreshWithList: (tokenList: TDict<TToken>) => Promise<TChainTokens>;
};

const defaultProps = {
	getToken: (): TToken => DEFAULT_ERC20,
	getBalance: (): TNormalizedBN => zeroNormalizedBN,
	balances: {},
	isLoading: true,
	onRefresh: async (): Promise<TChainTokens> => ({}),
	onRefreshWithList: async (): Promise<TChainTokens> => ({})
};

/*******************************************************************************
 ** This context controls most of the user's wallet data we may need to
 ** interact with our app, aka mostly the balances and the token prices.
 ******************************************************************************/
const WalletContext = createContext<TWalletContext>(defaultProps);
export const WalletContextApp = memo(function WalletContextApp({children}: {children: ReactElement}): ReactElement {
	const {currentNetworkTokenList} = useTokenList();
	const {address} = useWeb3();
	const {safeChainID} = useChainID();
	const {value: extraTokens, set: saveExtraTokens} = useLocalStorageValue<TTokenList['tokens']>('extraTokens', {
		defaultValue: []
	});

	/**************************************************************************
	 ** Define the list of available tokens. This list is retrieved from the
	 ** tokenList context and filtered to only keep the tokens of the current
	 ** network.
	 **************************************************************************/
	const availableTokens = useMemo((): TUseBalancesTokens[] => {
		const withTokenList = [...Object.values(currentNetworkTokenList)];
		const tokens: TUseBalancesTokens[] = [];
		withTokenList.forEach((token): void => {
			tokens.push({
				address: toAddress(token.address),
				chainID: token.chainID,
				decimals: Number(token.decimals),
				name: token.name,
				symbol: token.symbol
			});
		});

		const {wrappedToken} = getNetwork(safeChainID).contracts;
		if (wrappedToken) {
			tokens.push({
				address: toAddress(ETH_TOKEN_ADDRESS),
				chainID: safeChainID,
				decimals: wrappedToken.decimals,
				name: wrappedToken.coinName,
				symbol: wrappedToken.coinSymbol
			});
		}
		return tokens;
	}, [safeChainID, currentNetworkTokenList]);

	/**************************************************************************
	 ** This hook triggers the fetching of the balances of the available tokens
	 ** and stores them in a state. It also provides a function to refresh the
	 ** balances of the tokens.
	 **************************************************************************/
	const {data: balances, onUpdate, onUpdateSome, isLoading} = useBalances({tokens: availableTokens});

	/**************************************************************************
	 ** onRefresh is a function that allows to refresh the balances of the
	 ** tokens. It takes an optional list of tokens to refresh, and a boolean
	 ** to indicate if the list of tokens should be saved in the local storage.
	 ** This can also be used to add new tokens to the list of available tokens.
	 **************************************************************************/
	const onRefresh = useCallback(
		async (tokenToUpdate?: TUseBalancesTokens[], shouldSaveInStorage?: boolean): Promise<TChainTokens> => {
			if (tokenToUpdate && tokenToUpdate.length > 0) {
				const updatedBalances = await onUpdateSome(tokenToUpdate);
				if (shouldSaveInStorage) {
					saveExtraTokens([...(extraTokens || []), ...tokenToUpdate.map(t => toTokenListToken(t as TToken))]);
				}
				return updatedBalances;
			}
			const updatedBalances = await onUpdate();
			return updatedBalances;
		},
		[extraTokens, onUpdate, onUpdateSome, saveExtraTokens]
	);

	/**************************************************************************
	 ** onRefreshWithList is a function that allows to refresh the balances of
	 ** the tokens matching the tokenlist structure. It takes a list of tokens
	 ** to refresh and triggers the fetching of the balances of the tokens.
	 **************************************************************************/
	const onRefreshWithList = useCallback(
		async (newTokenList: TDict<TToken>): Promise<TChainTokens> => {
			const withDefaultTokens = [...Object.values(newTokenList)];
			const tokens: TUseBalancesTokens[] = [];
			withDefaultTokens.forEach((token): void => {
				tokens.push({
					address: toAddress(token.address),
					chainID: token.chainID,
					decimals: Number(token.decimals),
					name: token.name,
					symbol: token.symbol
				});
			});
			const tokensToFetch = tokens.filter((token): boolean => {
				return !availableTokens.find((availableToken): boolean => availableToken.address === token.address);
			});
			if (tokensToFetch.length > 0) {
				return await onRefresh(tokensToFetch);
			}
			return balances;
		},
		[balances, onRefresh, availableTokens]
	);

	/**************************************************************************
	 ** This useAsyncTrigger function is used to refresh the balances of the
	 ** tokens that are saved in the local storage. It is triggered when the
	 ** wallet is active.
	 **************************************************************************/
	useAsyncTrigger(async (): Promise<void> => {
		if (extraTokens && !isZeroAddress(address)) {
			await onUpdateSome(extraTokens.map(t => toTToken(t)));
		}
	}, [address, extraTokens, onUpdateSome]);

	/**************************************************************************
	 ** getToken is a safe retrieval of a token from the balances state
	 **************************************************************************/
	const getToken = useCallback(
		({address, chainID}: TTokenAndChain): TToken => balances?.[chainID || 1]?.[address] || DEFAULT_ERC20,
		[balances]
	);

	/**************************************************************************
	 ** getBalance is a safe retrieval of a balance from the balances state
	 **************************************************************************/
	const getBalance = useCallback(
		({address, chainID}: TTokenAndChain): TNormalizedBN =>
			balances?.[chainID || 1]?.[address]?.balance || zeroNormalizedBN,
		[balances]
	);

	/***************************************************************************
	 **	Setup and render the Context provider to use in the app.
	 ***************************************************************************/
	const contextValue = useDeepCompareMemo(
		(): TWalletContext => ({
			getToken,
			getBalance,
			balances,
			isLoading: isLoading || false,
			onRefresh,
			onRefreshWithList
		}),
		[getBalance, balances, getToken, isLoading, onRefresh, onRefreshWithList]
	);

	return <WalletContext.Provider value={contextValue}>{children}</WalletContext.Provider>;
});

export const useWallet = (): TWalletContext => useContext(WalletContext);
export default useWallet;
