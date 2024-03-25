type TProps = {
	chainID: number | string;
	baseURI?: string;
};

const defaultYDaemonUri = 'https://ydaemon.yearn.fi';

export function useYDaemonBaseURI(props?: TProps): {yDaemonBaseUri: string} {
	const yDaemonBaseUri = props?.baseURI || defaultYDaemonUri;

	if (!yDaemonBaseUri) {
		throw new Error('YDAEMON_BASE_URI is not defined');
	}

	if (!props?.chainID) {
		return {yDaemonBaseUri};
	}

	return {yDaemonBaseUri: `${yDaemonBaseUri}/${props.chainID}`};
}
