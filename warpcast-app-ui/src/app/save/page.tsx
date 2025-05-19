"use client"
import { useEffect, useState, useRef } from "react";
import { useAccount, useWalletClient, useConnect } from "wagmi";
import { parseEther, getContract, createPublicClient, http } from "viem";
import { abi, BLACKJACK_ADDRESS } from "@/lib/blackjackAbi"; // Ensure you have your contract's ABI here
import { monadTestnet } from "wagmi/chains";
import Image from "next/image";

// const BLACKJACK_ADDRESS = "0x3B10B843514659b386F3C33E541c382FdeE8Ed60"; // Replace with your deployed contract address

// Create a public client for read-only calls
const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(),
});

const blackjackRead = getContract({
    address: BLACKJACK_ADDRESS,
    abi,
    client: publicClient,
});

// Helper to generate random 32 bytes as a hex string
function getRandomBytes32Hex() {
    const arr = new Uint8Array(32);
    window.crypto.getRandomValues(arr);
    return '0x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper to map card value to image filename
function getCardImage(card: number) {
    if (card === 11) return "/cards/11.svg"; // Ace
    if (card === 10) return "/cards/10.svg";
    if (card === 9) return "/cards/9.svg";
    if (card === 8) return "/cards/8.svg";
    if (card === 7) return "/cards/7.svg";
    if (card === 6) return "/cards/6.svg";
    if (card === 5) return "/cards/5.svg";
    if (card === 4) return "/cards/4.svg";
    if (card === 3) return "/cards/3.svg";
    if (card === 2) return "/cards/2.svg";
    if (card === 12 || card === 13 || card === 14) return "/cards/face.svg";
    return "/cards/10.svg";
}

function getGameMessage(gameState: any, status: string) {
    if (!gameState) return status;
    if (!gameState[2]) {
        if (gameState[1] > 21) return "Bust! You lost.";
        return "Game over.";
    }
    if (gameState[3]) return "Blackjack! You win!";
    return status;
}

// Fetch chips from contract (read-only)
async function fetchChips(address: string, blackjackRead: any) {
    if (!address || !blackjackRead) return 0;
    try {
        // chips is a public mapping, so you can call .read.chips([address])
        const chips = await blackjackRead.read.chips([address]);
        return Number(chips);
    } catch {
        return 0;
    }
}

export default function Home() {
    const { address, isConnected } = useAccount();
    const { connect, connectors } = useConnect();
    const { data: walletClient } = useWalletClient();

    const [status, setStatus] = useState("");
    const [gameState, setGameState] = useState<any>(null);
    const [chips, setChips] = useState(0);
    const [isDrawing, setIsDrawing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cardRowRef = useRef<HTMLDivElement>(null);

    // Use wallet client for write calls
    const blackjack = walletClient
        ? getContract({
            address: BLACKJACK_ADDRESS,
            abi,
            client: walletClient,
        })
        : null;

    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

    // Poll game state for up to 60 seconds after a tx
    const pollGameState = async (address: string, blackjackRead: any, checkAlive: boolean) => {
        setError(null);
        let tries = 0;
        let lastState = null;
        while (tries < 5) { // 30 tries, 2s each = 60s
            try {
                const state = await blackjackRead.read.getGameState([address]);
                console.log(`[POLL] Try ${tries + 1}: gameState=`, state);
                lastState = state;
                // If checking for alive, break if isAlive is true
                if (checkAlive && state[2]) return state;
                // If checking for not alive, break if isAlive is false
                if (!checkAlive && !state[2]) return state;
            } catch (err) {
                console.error("[POLL] Error fetching gameState:", err);
            }
            await new Promise(res => setTimeout(res, 2000));
            tries++;
        }
        // setError("Game state did not update after 60 seconds. Please try refreshing or check contract events.");
        return lastState;
    };

    // Start Game with polling
    const startGameWithPolling = async () => {
        setStatus("Starting game...");
        setError(null);
        if (!blackjack || !address) {
            setError("Wallet or contract not ready.");
            console.error("[ERROR] Wallet or contract not ready.", { blackjack, address });
            return;
        }
        try {
            const randomHex = getRandomBytes32Hex();
            if (!randomHex) throw new Error("Failed to generate randomness");
            const fee = await blackjackRead.read.getFee() as bigint;
            console.log("[LOG] Fee from contract:", fee.toString());
            const bet = parseEther("1");
            const total_value = bet + fee;
            console.log("[LOG] Bet:", bet.toString(), "Total value (bet+fee):", total_value.toString());
            let tx;
            try {
                console.log('randomHex', randomHex);
                console.log('resetting game');
                await blackjack.write.resetGame(); // TODO: uncomment this
                console.log('reset game done');
                console.log('starting game');
                tx = await blackjack.write.startGame([randomHex], { value: total_value });
                console.log('start game done');
            } catch (err: any) {
                console.error("[ERROR] Transaction send failed:", err);
                if (err.message?.includes("insufficient funds")) {
                    setError("Insufficient funds. Please add more MON to your wallet.");
                } else if (err.message?.includes("user rejected transaction")) {
                    setError("Transaction rejected. Please try again.");
                } else if (err.message?.includes("revert")) {
                    setError("Contract reverted. Please check your bet and try again.");
                } else if (err.message?.includes("network")) {
                    setError("Network error. Please check your connection and try again.");
                } else {
                    setError("Failed to send transaction: " + (err?.message || String(err)));
                }
                setStatus("");
                return;
            }
            console.log("[TX] Start Game hash:", tx);
            setStatus("Waiting for game to start (randomness callback)...");
            // Poll for isAlive true
            if (address) {
                const state = await pollGameState(address, blackjackRead, true);
                console.log("[LOG] Game state after polling:", state);
                setGameState(state);
                setStatus("Game started!");
            }
        } catch (err: any) {
            console.error("[ERROR] startGameWithPolling failed:", err);
            setError("Failed to start game. " + (err?.message || String(err)));
            setStatus("");
        }
    };

    // Draw Card with polling
    const handleDrawCardWithPolling = async () => {
        setIsDrawing(true);
        setError(null);
        if (!blackjack || !address) {
            setError("Wallet or contract not ready.");
            console.error("[ERROR] Wallet or contract not ready.", { blackjack, address });
            setIsDrawing(false);
            return;
        }
        try {
            const randomHex = getRandomBytes32Hex();
            if (!randomHex) throw new Error("Failed to generate randomness");
            const fee = await blackjackRead.read.getFee() as bigint;
            console.log("[LOG] Fee from contract:", fee.toString());
            let tx;
            try {
                tx = await blackjack.write.drawCard([randomHex], { value: fee });
            } catch (err: any) {
                console.error("[ERROR] Transaction send failed:", err);
                if (err.message?.includes("insufficient funds")) {
                    setError("Insufficient funds. Please add more MON to your wallet.");
                } else if (err.message?.includes("user rejected transaction")) {
                    setError("Transaction rejected. Please try again.");
                } else if (err.message?.includes("revert")) {
                    setError("Contract reverted. Please check your bet and try again.");
                } else if (err.message?.includes("network")) {
                    setError("Network error. Please check your connection and try again.");
                } else {
                    setError("Failed to send transaction: " + (err?.message || String(err)));
                }
                setStatus("");
                setIsDrawing(false);
                return;
            }
            console.log("[TX] Draw Card hash:", tx);
            setStatus("Drawing card (waiting for randomness callback)...");
            // Poll for isAlive (could be true or false, so just update state)
            if (address) {
                const state = await pollGameState(address, blackjackRead, false);
                console.log("[LOG] Game state after polling:", state);
                setGameState(state);
                setStatus("Card drawn.");
            }
        } catch (err: any) {
            console.error("[ERROR] handleDrawCardWithPolling failed:", err);
            setError("Failed to draw card. " + (err?.message || String(err)));
            setStatus("");
        }
        setIsDrawing(false);
    };

    // Fetch chips whenever address or gameState changes
    useEffect(() => {
        if (!address) return;
        fetchChips(address, blackjackRead).then(setChips);
    }, [address, gameState]);

    // Reset game handler
    const handleResetGame = async () => {
        if (!blackjack) return;
        setIsResetting(true);
        try {
            await blackjack.write.resetGame();
            setStatus("Game reset. You can start a new game.");
            setGameState(null);
        } catch (err) {
            setStatus("Failed to reset game.");
        }
        setIsResetting(false);
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-green-900 bg-[repeating-linear-gradient(135deg,#228B22_0_20px,#006400_20px_40px)] font-sans">
            <div className="w-full max-w-md rounded-3xl shadow-2xl bg-white/80 border-4 border-green-800 p-0 flex flex-col items-center relative backdrop-blur-md">
                {/* Header Row */}
                <div className="flex flex-row items-center justify-between w-full px-6 pt-6 pb-2">
                    <div className="flex items-center gap-2">
                        {/* <Image src="/cards/10.svg" alt="logo" width={36} height={36} /> */}
                        <span className="text-2xl font-extrabold text-green-900 drop-shadow-lg tracking-tight">Blackjack Mini App</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Image src="/cards/peacock.svg" alt="chips" width={24} height={24} />
                        <span className="bg-yellow-300 text-green-900 font-bold px-3 py-1 rounded-full shadow text-base border-2 border-yellow-500">{chips} Chips</span>
                    </div>
                </div>
                {/* Main Table Area */}
                <div className="w-full flex flex-col items-center px-6 pb-8 pt-2">
                    {error && <div className="bg-red-100 text-red-700 border border-red-400 rounded px-4 py-2 mb-4 w-full text-center font-semibold">{error}</div>}
                    {!isConnected ? (
                        <>
                            <p className="text-green-900 mb-4 mt-4 text-lg font-medium">Please connect your wallet via Warpcast</p>
                            <button
                                className="bg-yellow-400 hover:bg-yellow-500 text-green-900 font-bold px-8 py-2 rounded-lg shadow transition text-lg"
                                onClick={() => connect({ connector: connectors[0] })}
                            >
                                Connect
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="flex flex-col items-center w-full">
                                {/* Show Start Game only if no gameState or isAlive is false */}
                                {(!gameState || (gameState && !gameState[2])) && (
                                    <button
                                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-8 py-2 rounded-lg shadow mb-4 transition text-lg"
                                        onClick={startGameWithPolling}
                                    >
                                        Start Game (1 MON)
                                    </button>
                                )}
                                {/* Show Draw Card only if gameState exists, isAlive is true, and hasBlackjack is false */}
                                {gameState && gameState[2] && !gameState[3] && (
                                    <button
                                        className="bg-yellow-400 hover:bg-yellow-500 text-green-900 font-bold px-8 py-2 rounded-lg shadow mb-4 transition text-lg"
                                        onClick={handleDrawCardWithPolling}
                                        disabled={isDrawing}
                                    >
                                        {isDrawing ? (
                                            <span className="flex items-center gap-2">
                                                <svg className="animate-spin h-5 w-5 text-green-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path></svg>
                                                Drawing...
                                            </span>
                                        ) : "Draw Card"}
                                    </button>
                                )}
                                {/* Show Play New Game if user wins (Blackjack) or game is over (isAlive is false) */}
                                {gameState && (!gameState[2] || gameState[3]) && (
                                    <button
                                        className="bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-2 rounded-lg shadow mb-4 transition text-lg"
                                        onClick={handleResetGame}
                                        disabled={isResetting}
                                    >
                                        {isResetting ? "Resetting..." : "Play New Game"}
                                    </button>
                                )}
                            </div>
                            {gameState && (
                                <div className="flex flex-col items-center mt-4 w-full">
                                    <div ref={cardRowRef} className="flex flex-row gap-4 mb-4 transition-all duration-500 justify-center">
                                        {gameState[0].map((card: number, idx: number) => (
                                            <div key={idx} className={`transition-transform duration-500 ${isDrawing && idx === gameState[0].length - 1 ? "animate-bounce" : ""}`}>
                                                <Image
                                                    src={getCardImage(card)}
                                                    alt={`Card ${card}`}
                                                    width={70}
                                                    height={100}
                                                    className="rounded-xl shadow-lg bg-white border-2 border-green-800"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    {/* Stats Bar */}
                                    <div className="flex flex-row gap-4 justify-center mb-2 mt-2 w-full">
                                        <span className="bg-white/90 text-green-900 font-bold px-5 py-2 rounded-full shadow border-2 border-green-700 flex items-center gap-2 text-base">
                                            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#27ae60" strokeWidth="3" fill="#fff" /><text x="7" y="16" fontSize="12" fill="#27ae60" fontFamily="Arial Black">Sum</text></svg>
                                            {gameState[1]}
                                        </span>
                                        <span className={`font-bold px-5 py-2 rounded-full shadow border-2 flex items-center gap-2 text-base ${gameState[2] ? "bg-green-400/90 text-green-900 border-green-700" : "bg-red-200/90 text-red-700 border-red-400"}`}>
                                            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#e74c3c" strokeWidth="3" fill="#fff" /><text x="4" y="16" fontSize="12" fill="#e74c3c" fontFamily="Arial Black">Alive</text></svg>
                                            {gameState[2] ? "Yes" : "No"}
                                        </span>
                                        <span className={`font-bold px-5 py-2 rounded-full shadow border-2 flex items-center gap-2 text-base ${gameState[3] ? "bg-yellow-300/90 text-yellow-900 border-yellow-500" : "bg-gray-200/90 text-gray-700 border-gray-400"}`}>
                                            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="#f1c40f" strokeWidth="3" fill="#fff" /><text x="2" y="16" fontSize="12" fill="#f1c40f" fontFamily="Arial Black">BJ</text></svg>
                                            {gameState[3] ? "Yes" : "No"}
                                        </span>
                                    </div>
                                    <div className={`text-center text-xl font-bold mt-2 ${gameState[3] ? "text-yellow-400" : !gameState[2] ? "text-red-500" : "text-green-900"}`}>
                                        {getGameMessage(gameState, status)}
                                    </div>
                                </div>
                            )}
                            {!gameState && (
                                <div className="text-green-900 text-center mt-6 text-lg font-mono">{status}</div>
                            )}
                        </>
                    )}
                </div>
            </div>
            <div className="mt-8 text-green-200 text-xs opacity-70">Built by BossOnormal1</div>
            <div className="mt-2 text-green-200 text-xs opacity-70">Powered by Warpcast Mini Apps</div>
            <style jsx global>{`
        .animate-bounce {
          animation: bounce 0.8s;
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-30px) scale(1.1); }
        }
      `}</style>
        </div>
    );
}
