/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable prefer-destructuring */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/naming-convention */
import {getAddress, numberToHex, type ProviderRpcError, SwitchChainError, UserRejectedRequestError} from 'viem';
import {injected} from 'wagmi/connectors';
import {createConnector, normalizeChainId} from '@wagmi/core';
import {type EthereumProviderOptions} from '@walletconnect/ethereum-provider';

import type {EthereumProvider} from '@ledgerhq/connect-kit/dist/umd/index.d.ts';
import type {Wallet} from '@rainbow-me/rainbowkit';
import type {WalletProviderFlags, WindowProvider} from '@rainbow-me/rainbowkit/dist/types/utils';
import type {CreateConnector, WalletDetailsParams} from '@rainbow-me/rainbowkit/dist/wallets/Wallet';
import type {Evaluate} from '@wagmi/core/internal';

type LedgerConnectorWcV2Options = {
	enableDebugLogs?: boolean;
	walletConnectVersion?: 2;
	projectId?: EthereumProviderOptions['projectId'];
	requiredChains?: number[];
	requiredMethods?: string[];
	optionalMethods?: string[];
	requiredEvents?: string[];
	optionalEvents?: string[];
};

export type LedgerParameters = Evaluate<
	LedgerConnectorWcV2Options & {
		enableDebugLogs?: boolean;
		/**
     Target chain to connect to.
     */
		chainId?: number | undefined;
	}
>;

ledger.type = 'ledger' as const;
export function ledger(parameters: LedgerParameters) {
	type Provider = EthereumProvider;
	type Properties = {
		createProvider: any;
		initProvider: any;
		setupListeners: any;
		removeListeners: any;
	};

	let provider_: Provider | undefined;
	let initProviderPromise: Promise<void>;
	const enableDebugLogs = parameters.enableDebugLogs ?? false;

	return createConnector<Provider, Properties>(config => ({
		id: 'ledger',
		name: 'Ledger',
		type: ledger.type,
		async connect({chainId}: {chainId?: number} = {}) {
			try {
				const provider = await this.getProvider();
				this.setupListeners();

				// Don't request accounts if we have a session, like when reloading with
				// an active WC v2 session
				if (!provider.session) {
					config.emitter.emit('message', {type: 'connecting'});

					await provider.request({
						method: 'eth_requestAccounts'
					});
				}

				const accounts = await this.getAccounts();
				let id = await this.getChainId();

				if (chainId && id !== chainId) {
					const chain = await this.switchChain!({chainId}).catch(() => ({
						id
					}));
					id = chain.id;
				}

				return {
					accounts,
					chainId: id,
					provider
				};
			} catch (error) {
				console.error(error);
				if (/user rejected/i.test((error as ProviderRpcError)?.message)) {
					throw new UserRejectedRequestError(error as Error);
				}
				throw error;
			}
		},

		async disconnect() {
			const provider = await this.getProvider();
			try {
				if (provider?.disconnect) {
					await provider.disconnect();
				}
			} catch (error) {
				if (!/No matching key/i.test((error as Error).message)) {
					throw error;
				}
			} finally {
				this.removeListeners();
			}
		},

		async getAccounts() {
			const provider = await this.getProvider();
			const accounts = (await provider.request({
				method: 'eth_accounts'
			})) as string[];
			return accounts.map(getAddress);
		},

		async getChainId() {
			const provider = await this.getProvider();
			const chainId = (await provider.request({
				method: 'eth_chainId'
			})) as number;

			return normalizeChainId(chainId);
		},

		async getProvider({chainId} = {}) {
			if (!provider_) {
				await this.createProvider();
			}

			if (chainId) {
				await this.switchChain?.({chainId});
			}
			return provider_!;
		},

		async isAuthorized() {
			try {
				const accounts = await this.getAccounts();

				return !!accounts.length;
			} catch {
				return false;
			}
		},

		async switchChain({chainId}) {
			const chain = config.chains.find(chain => chain.id === chainId);
			if (!chain) {
				throw new SwitchChainError(new Error('chain not found on connector.'));
			}

			try {
				const provider = await this.getProvider();

				await provider.request({
					method: 'wallet_switchEthereumChain',
					params: [{chainId: numberToHex(chainId)}]
				});

				return chain;
			} catch (error) {
				const message = typeof error === 'string' ? error : (error as ProviderRpcError)?.message;
				if (/user rejected request/i.test(message)) {
					throw new UserRejectedRequestError(error as Error);
				}
				throw new SwitchChainError(error as Error);
			}
		},
		async createProvider() {
			if (!initProviderPromise && typeof window !== 'undefined') {
				initProviderPromise = this.initProvider();
			}
			return initProviderPromise;
		},
		async initProvider() {
			const connectKit = await import('@ledgerhq/connect-kit/dist/umd');

			if (enableDebugLogs) {
				connectKit.enableDebugLogs();
			}

			const {projectId, requiredChains, requiredMethods, optionalMethods, requiredEvents, optionalEvents} =
				parameters as LedgerConnectorWcV2Options;
			const optionalChains = config.chains.map(({id}) => id);

			const checkSupportOptions = {
				providerType: connectKit.SupportedProviders.Ethereum,
				walletConnectVersion: 2,
				projectId,
				chains: requiredChains,
				optionalChains,
				methods: requiredMethods,
				optionalMethods,
				events: requiredEvents,
				optionalEvents,
				rpcMap: Object.fromEntries(config.chains.map(chain => [chain.id, chain.rpcUrls.default.http[0]!]))
			};
			connectKit.checkSupport(checkSupportOptions);

			provider_ = (await connectKit.getProvider()) as unknown as EthereumProvider;
		},
		setupListeners() {
			if (!provider_) {
				return;
			}
			this.removeListeners();
			provider_.on('accountsChanged', this.onAccountsChanged);
			provider_.on('chainChanged', this.onChainChanged);
			provider_.on('disconnect', this.onDisconnect);
			provider_.on('session_delete', this.onDisconnect);
			provider_.on('connect', this.onConnect?.bind(this));
		},
		removeListeners() {
			if (!provider_) {
				return;
			}
			provider_.removeListener('accountsChanged', this.onAccountsChanged);
			provider_.removeListener('chainChanged', this.onChainChanged);
			provider_.removeListener('disconnect', this.onDisconnect);
			provider_.removeListener('session_delete', this.onDisconnect);
			provider_.removeListener('connect', this.onConnect?.bind(this));
		},
		onAccountsChanged(accounts: string[]) {
			if (accounts.length === 0) {
				config.emitter.emit('disconnect');
			} else {
				config.emitter.emit('change', {accounts: accounts.map(getAddress)});
			}
		},
		onChainChanged(chainId: number | string) {
			const id = normalizeChainId(chainId);
			config.emitter.emit('change', {chainId: id});
		},
		onDisconnect() {
			config.emitter.emit('disconnect');
		},
		async onConnect() {
			const accounts = await this.getAccounts();
			const chainId = await this.getChainId();
			config.emitter.emit('connect', {accounts, chainId});
		}
	}));
}
export type MyWalletOptions = {
	projectId: string;
};
export const legderLiveIFrameWallet = ({projectId}: MyWalletOptions): Wallet => ({
	id: 'ledger-live',
	iconBackground: '#000',
	iconAccent: '#000',
	name: 'Ledger Live',
	iconUrl:
		'https://raw.githubusercontent.com/rainbow-me/rainbowkit/d8c64ee4baf865d3452a6b92e0525c123f680ec1/packages/rainbowkit/src/wallets/walletConnectors/ledgerWallet/ledgerWallet.svg',
	downloadUrls: {
		// We're opting not to provide a download prompt if the application is not
		// already running as a Safe App within the context of the Safe browser,
		// since it's unlikely to be a desired behavior for users.
	},
	installed:
		// Only allowed in iframe context
		// borrowed from wagmi safe connector
		!(typeof window === 'undefined') && window?.parent !== window,
	// createConnector: getInjectedConnector({flag: 'isLedgerLive' as WalletProviderFlags}) || ledger({projectId})
	createConnector: (walletDetails: WalletDetailsParams) => {
		return createConnector(config => ({
			...ledger({projectId})(config),
			...walletDetails
		}));
	}
});

/*
 * Returns the explicit window provider that matches the flag and the flag is true
 */
function getExplicitInjectedProvider(flag: WalletProviderFlags) {
	const _window = typeof window !== 'undefined' ? (window as WindowProvider) : undefined;
	if (typeof _window?.ethereum === 'undefined') {
		return;
	}
	const providers = _window.ethereum.providers;
	return providers
		? providers.find(provider => provider[flag])
		: _window.ethereum[flag]
			? _window.ethereum
			: undefined;
}

/*
 * Gets the `window.namespace` window provider if it exists
 */
function getWindowProviderNamespace(namespace: string) {
	const providerSearch = (provider: any, namespace: string): any => {
		const [property, ...path] = namespace.split('.');
		const _provider = provider[property];
		if (_provider) {
			if (path.length === 0) {
				return _provider;
			}
			return providerSearch(_provider, path.join('.'));
		}
	};
	if (typeof window !== 'undefined') {
		return providerSearch(window, namespace);
	}
}

/*
 * Checks if the explict provider or window ethereum exists
 */
export function hasInjectedProvider({flag, namespace}: {flag?: WalletProviderFlags; namespace?: string}): boolean {
	if (namespace && typeof getWindowProviderNamespace(namespace) !== 'undefined') {
		return true;
	}
	if (flag && typeof getExplicitInjectedProvider(flag) !== 'undefined') {
		return true;
	}
	return false;
}

/*
 * Returns an injected provider that favors the flag match, but falls back to window.ethereum
 */
function getInjectedProvider({flag, namespace}: {flag?: WalletProviderFlags; namespace?: string}) {
	const _window = typeof window !== 'undefined' ? (window as WindowProvider) : undefined;
	if (typeof _window === 'undefined') {
		return;
	}
	if (namespace) {
		// prefer custom eip1193 namespaces
		const windowProvider = getWindowProviderNamespace(namespace);
		if (windowProvider) {
			return windowProvider;
		}
	}
	const providers = _window.ethereum?.providers;
	if (flag) {
		const provider = getExplicitInjectedProvider(flag);
		if (provider) {
			return provider;
		}
	}
	if (typeof providers !== 'undefined' && providers.length > 0) {
		return providers[0];
	}
	return _window.ethereum;
}

function createInjectedConnector(provider?: any): CreateConnector {
	return (walletDetails: WalletDetailsParams) => {
		// Create the injected configuration object conditionally based on the provider.
		const injectedConfig = provider
			? {
					target: () => ({
						id: walletDetails.rkDetails.id,
						name: walletDetails.rkDetails.name,
						provider
					})
				}
			: {};

		return createConnector(config => ({
			// Spread the injectedConfig object, which may be empty or contain the target function
			...injected(injectedConfig)(config),
			...walletDetails
		}));
	};
}

export function getInjectedConnector({
	flag,
	namespace,
	target
}: {
	flag?: WalletProviderFlags;
	namespace?: string;
	target?: any;
}): CreateConnector {
	const provider = target ? target : getInjectedProvider({flag, namespace});
	return createInjectedConnector(provider);
}
