import {createContext, useCallback, useContext, useMemo, useState} from 'react';
import {
	useAccount,
	useConnect,
	useDisconnect,
	useEnsName,
	useNetwork,
	usePublicClient,
	useSwitchNetwork,
	useWalletClient
} from 'wagmi';
import * as _RainbowKitProvider from '@rainbow-me/rainbowkit';
import {useIsMounted, useMountEffect, useUpdateEffect} from '@react-hookz/web';

import {assert} from '../utils/assert';
import {isIframe} from '../utils/helpers';
import {toAddress} from '../utils/tools.address';

import type {ReactElement} from 'react';
import type {Connector} from 'wagmi';
import type {Chain} from '@wagmi/core';
import type {TAddress} from '../types/address';

const {useConnectModal} = _RainbowKitProvider;

type TWeb3Context = {
	address: TAddress | undefined;
	ens: string | undefined;
	lensProtocolHandle: string | undefined;
	chainID: number;
	isDisconnected: boolean;
	isActive: boolean;
	isConnecting: boolean;
	isWalletSafe: boolean;
	isWalletLedger: boolean;
	hasProvider: boolean;
	provider?: Connector;
	onConnect: () => Promise<void>;
	onSwitchChain: (newChainID: number) => void;
	openLoginModal: () => void;
	onDesactivate: () => void;
};

const defaultState: TWeb3Context = {
	address: undefined,
	ens: undefined,
	lensProtocolHandle: undefined,
	chainID: 1,
	isDisconnected: false,
	isActive: false,
	isConnecting: false,
	isWalletSafe: false,
	isWalletLedger: false,
	hasProvider: false,
	provider: undefined,
	onConnect: async (): Promise<void> => undefined,
	onSwitchChain: (): void => undefined,
	openLoginModal: (): void => undefined,
	onDesactivate: (): void => undefined
};

const Web3Context = createContext<TWeb3Context>(defaultState);
export const Web3ContextApp = ({children}: {children: ReactElement}): ReactElement => {
	const {address, isConnecting, isConnected, isDisconnected, connector} = useAccount();
	const {connectors, connectAsync} = useConnect();
	const {disconnect} = useDisconnect();
	const {switchNetwork} = useSwitchNetwork();
	const {data: ensName} = useEnsName({address: address, chainId: 1});
	const {data: walletClient} = useWalletClient();
	const {chain} = useNetwork();
	const [currentChainID, set_currentChainID] = useState(chain?.id);
	const publicClient = usePublicClient();
	const isMounted = useIsMounted();
	const {openConnectModal} = useConnectModal();

	const supportedChainsID = useMemo((): number[] => {
		const injectedConnector = connectors.find((e): boolean => e.id.toLocaleLowerCase() === 'injected');
		assert(injectedConnector, 'No injected connector found');
		const chainsForInjected = injectedConnector.chains;
		const noTestnet = chainsForInjected.filter(({id}): boolean => id !== 1337);
		return noTestnet.map((network: Chain): number => network.id);
	}, [connectors]);

	useUpdateEffect((): void => {
		set_currentChainID(chain?.id);
	}, [chain]);

	useMountEffect(async (): Promise<void> => {
		if (isIframe()) {
			const ledgerConnector = connectors.find((c): boolean => c.id === 'ledgerLive');
			if (ledgerConnector) {
				await connectAsync({connector: ledgerConnector, chainId: chain?.id || 1});
				return;
			}
		}
	});

	const onConnect = useCallback(async (): Promise<void> => {
		const ledgerConnector = connectors.find((c): boolean => c.id === 'ledgerLive');
		if (isIframe() && ledgerConnector) {
			await connectAsync({connector: ledgerConnector, chainId: currentChainID});
			return;
		}

		if (openConnectModal) {
			openConnectModal();
		} else {
			console.warn('Impossible to open login modal');
		}
	}, [connectAsync, connectors, currentChainID, openConnectModal]);

	const onDesactivate = useCallback((): void => {
		disconnect();
	}, [disconnect]);

	const onSwitchChain = useCallback(
		(newChainID: number): void => {
			set_currentChainID(newChainID);
			if (isConnected) {
				if (!switchNetwork) {
					throw new Error('Switch network function is not defined');
				}
				switchNetwork?.(newChainID);
			}
		},
		[switchNetwork, isConnected]
	);

	const openLoginModal = useCallback(async (): Promise<void> => {
		const ledgerConnector = connectors.find((c): boolean => c.id === 'ledgerLive');
		if (isIframe() && ledgerConnector) {
			await connectAsync({connector: ledgerConnector, chainId: currentChainID});
			return;
		}

		if (openConnectModal) {
			openConnectModal();
		} else {
			console.warn('Impossible to open login modal');
		}
	}, [connectAsync, connectors, currentChainID, openConnectModal]);

	const contextValue = {
		address: address ? toAddress(address) : undefined,
		isConnecting,
		isDisconnected,
		ens: ensName || '',
		isActive: isConnected && [...supportedChainsID, 1337].includes(chain?.id || -1) && isMounted(),
		isWalletSafe: connector?.id === 'safe' || (connector as any)?._wallets?.[0]?.id === 'safe',
		isWalletLedger:
			connector?.id === 'ledger' ||
			(connector as any)?._wallets?.[0]?.id === 'ledger' ||
			connector?.id === 'ledgerLive',
		lensProtocolHandle: '',
		hasProvider: !!(walletClient || publicClient),
		provider: connector,
		chainID: isConnected ? Number(chain?.id || 1) : Number(currentChainID || 1),
		onConnect,
		onSwitchChain,
		openLoginModal,
		onDesactivate: onDesactivate
	};

	return <Web3Context.Provider value={contextValue}>{children}</Web3Context.Provider>;
};

export const useWeb3 = (): TWeb3Context => useContext(Web3Context);
