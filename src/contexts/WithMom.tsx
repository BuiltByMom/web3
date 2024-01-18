import {useMemo} from 'react';
import {configureChains, WagmiConfig} from 'wagmi';
import {RainbowKitProvider} from '@rainbow-me/rainbowkit';

import {getConfig, getSupportedProviders} from '../utils/wagmi/config';
import {Web3ContextApp} from './useWeb3';
import {WithTokenList} from './WithTokenList';

import type {ReactElement} from 'react';
import type {FallbackTransport} from 'viem';
import type {Config, PublicClient, WebSocketPublicClient} from 'wagmi';
import type {Chain} from '@wagmi/core';

type TWithMom = {
	children: ReactElement;
	supportedChains: Chain[];
	tokenLists?: string[];
};

function WithMom({children, supportedChains, tokenLists}: TWithMom): ReactElement {
	const config = useMemo((): Config<PublicClient<FallbackTransport>, WebSocketPublicClient<FallbackTransport>> => {
		const {chains, publicClient, webSocketPublicClient} = configureChains(supportedChains, getSupportedProviders());
		return getConfig({chains, publicClient, webSocketPublicClient});
	}, [supportedChains]);

	return (
		<WagmiConfig config={config}>
			<RainbowKitProvider chains={supportedChains}>
				<Web3ContextApp>
					<WithTokenList lists={tokenLists}>
						<>{children}</>
					</WithTokenList>
				</Web3ContextApp>
			</RainbowKitProvider>
		</WagmiConfig>
	);
}

export {WithMom};
