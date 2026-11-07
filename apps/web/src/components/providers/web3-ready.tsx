"use client";

import { createContext, useContext } from "react";

/** True only after WagmiProvider / RainbowKit have mounted around the tree. */
export const Web3ReadyContext = createContext(false);

export function useWeb3Ready() {
  return useContext(Web3ReadyContext);
}
