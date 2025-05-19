import { http, createConfig } from 'wagmi';
import { monadTestnet } from 'wagmi/chains';
// import { injected } from 'wagmi/connectors';
import { farcasterFrame as miniAppConnector } from '@farcaster/frame-wagmi-connector';

export const config = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(),
  },
  connectors: [miniAppConnector()],
});
