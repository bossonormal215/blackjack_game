"use client";
import { useEffect, useState, useRef } from "react";
import { useAccount, useWalletClient, useConnect } from "wagmi";
import { parseEther, getContract, createPublicClient, http } from "viem";
import { abi, BLACKJACK_ADDRESS } from "@/lib/blackjackAbi";
import { monadTestnet } from "wagmi/chains";
import Image from "next/image";

// const BLACKJACK_ADDRESS_1 = "0x5783E7eC4ef5e3a1FC69B543a85dAB18F659C059";

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
  return (
    "0x" +
    Array.from(arr)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
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
  const pollGameState = async (
    address: string,
    blackjackRead: any,
    checkAlive: boolean
  ) => {
    setError(null);
    let tries = 0;
    let lastState = null;
    while (tries < 5) {
      // 30 tries, 2s each = 60s
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
      await new Promise((res) => setTimeout(res, 2000));
      tries++;
    }
    return lastState;
  };

  // Start Game with polling
  const startGameWithPolling = async () => {
    setStatus("Starting game...");
    setError(null);
    if (!blackjack || !address) {
      setError("Wallet or contract not ready.");
      console.error("[ERROR] Wallet or contract not ready.", {
        blackjack,
        address,
      });
      return;
    }
    try {
      const randomHex = getRandomBytes32Hex();
      if (!randomHex) throw new Error("Failed to generate randomness");
      const fee = (await blackjackRead.read.getFee()) as bigint;
      console.log("[LOG] Fee from contract:", fee.toString());
      const bet = parseEther("1");
      const total_value = bet + fee;
      console.log(
        "[LOG] Bet:",
        bet.toString(),
        "Total value (bet+fee):",
        total_value.toString()
      );
      let tx;
      try {
        console.log("randomHex", randomHex);
        console.log("resetting game");
        setGameState(null);
        // await blackjack.write.resetGame(); // TODO: uncomment this
        console.log("reset game done");
        console.log("starting game");

        console.log("simulating transaction");

        // Simulate the transaction
        try {
          await blackjackRead.simulate.startGame([randomHex], {
            value: total_value,
            account: address,
          });
        } catch (error: any) {
          console.log("error", error);

          const errorString =
            error?.error?.message ||
            error?.reason ||
            error?.message ||
            "unknown error";
          let userError = "";
          if (errorString.toLowerCase().includes("insufficient balance")) {
            userError =
              "Insufficient funds. Please add more MON to your wallet.";
          } else if (errorString.toLowerCase().includes("user rejected")) {
            userError = "Transaction rejected by user.";
          } else if (errorString.toLowerCase().includes("revert")) {
            userError =
              "Contract reverted. Please check your bet and try again.";
          }

          setError(userError);
          return;
        }

        tx = await blackjack.write.startGame([randomHex], {
          value: total_value,
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        const state = await pollGameState(address, blackjackRead, true);
        console.log("[LOG] Game state after polling:", state);
        setGameState(state);
        setStatus("Game started!");
        console.log("start game done");
      } catch (err: any) {
        console.error("[ERROR] Transaction send failed:", err);
        const errorString =
          err?.error?.message || err?.reason || err?.message || "unknown error";
        let userError = "";
        if (errorString.toLowerCase().includes("insufficient balance")) {
          userError = "Insufficient funds. Please add more MON to your wallet.";
        } else if (errorString.toLowerCase().includes("user rejected")) {
          userError = "Transaction rejected by user.";
        } else if (errorString.toLowerCase().includes("revert")) {
          userError = "Contract reverted. Please check your bet and try again.";
        } else if (errorString.toLowerCase().includes("network")) {
          userError =
            "Network error. Please check your connection and try again.";
        } else {
          userError = `❌ Transaction failed: ${errorString}`;
        }
        setError(userError);
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
      console.error("[ERROR] Wallet or contract not ready.", {
        blackjack,
        address,
      });
      setIsDrawing(false);
      return;
    }
    try {
      const randomHex = getRandomBytes32Hex();
      if (!randomHex) throw new Error("Failed to generate randomness");
      const fee = (await blackjackRead.read.getFee()) as bigint;
      console.log("[LOG] Fee from contract:", fee.toString());
      let tx;
      try {
        try {
          await blackjackRead.simulate.drawCard([randomHex], {
            value: fee,
            account: address,
          });
        } catch (error: any) {
          console.log("error", error);

          const errorString =
            error?.error?.message ||
            error?.reason ||
            error?.message ||
            "unknown error";
          let userError = "";
          if (errorString.toLowerCase().includes("insufficient balance")) {
            userError =
              "Insufficient funds. Please add more MON to your wallet.";
          } else if (errorString.toLowerCase().includes("user rejected")) {
            userError = "Transaction rejected by user.";
          } else if (errorString.toLowerCase().includes("revert")) {
            userError =
              "Contract reverted. Please check your bet and try again.";
          } else if (errorString.toLowerCase().includes("Blackjack already")) {
            userError = "Blackjack already. Please start a new game.";
          } else if (errorString.toLowerCase().includes("No active game")) {
            userError = "No active game. Please start a new game.";
          } else if (errorString.toLowerCase().includes("insufficient fee")) {
            userError = "Insufficient fee. Please add more MON to your wallet.";
          } else {
            userError = `❌ Transaction failed: ${errorString}`;
          }

          setError(userError);
          setIsDrawing(false);
          return;
        }

        tx = await blackjack.write.drawCard([randomHex], { value: fee });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      } catch (err: any) {
        console.error("[ERROR] Transaction send failed:", err);
        const errorString =
          err?.error?.message || err?.reason || err?.message || "unknown error";
        let userError = "";
        if (errorString.toLowerCase().includes("insufficient balance")) {
          userError = "Insufficient funds. Please add more MON to your wallet.";
        } else if (errorString.toLowerCase().includes("user rejected")) {
          userError = "Transaction rejected by user.";
        } else if (errorString.toLowerCase().includes("revert")) {
          userError = "Contract reverted. Please check your bet and try again.";
        } else if (errorString.toLowerCase().includes("No active game")) {
          userError = "No active game, Start a new game first";
        } else if (errorString.toLowerCase().includes("Blackjack already")) {
          userError = `❌ Transaction failed: ${errorString}`;
        }
        setError(userError);
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
      // Simulate the transaction
      try {
        await blackjackRead.simulate.resetGame({ account: address });
      } catch (error: any) {
        console.log("error", error);

        const errorString =
          error?.error?.message ||
          error?.reason ||
          error?.message ||
          "unknown error";
        let userError = "";
        if (errorString.toLowerCase().includes("insufficient balance")) {
          userError = "Insufficient funds. Please add more MON to your wallet.";
        } else if (errorString.toLowerCase().includes("user rejected")) {
          userError = "Transaction rejected by user.";
        } else if (errorString.toLowerCase().includes("revert")) {
          userError = "Contract reverted. Please check your bet and try again.";
        }

        setError(userError);
        setIsResetting(false);
        return;
      }

      const tx = await blackjack.write.resetGame();
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("Game reset. You can start a new game.");
      setGameState(null);
    } catch (err: any) {
      console.error("[ERROR] Reset game failed:", err);
      const errorString =
        err?.error?.message || err?.reason || err?.message || "unknown error";
      let userError = "";
      if (errorString.toLowerCase().includes("user rejected")) {
        userError = "Transaction rejected by user.";
      } else {
        userError = `Failed to reset game: ${errorString}`;
      }
      setStatus(userError);
    }
    setIsResetting(false);
  };

  return (
    <div className="min-h-screen  overflow-hidden flex flex-col items-center justify-center p-4 bg-gradient-to-b from-green-800 to-green-950 font-sans">
      {" "}
      {/* TODO: remove h-screen w-screen*/}
      <div className="w-full max-w-md rounded-xl shadow-2xl bg-white/90 overflow-hidden flex flex-col items-center relative backdrop-blur-md border border-green-700">
        {/* Header Row */}
        <div className="w-full bg-green-800 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* <Image src="/cards/10.svg" alt="logo" width={28} height={28} className="drop-shadow-md" /> */}
            <span className="text-xl font-bold tracking-tight">
              BlackJack Mini App
            </span>
          </div>
          <div className="flex items-center gap-2 bg-yellow-400 text-green-900 px-3 py-1 rounded-full shadow-md">
            <Image
              src="/cards/peacock.svg"
              alt="chips"
              width={20}
              height={20}
            />
            <span className="font-bold text-sm">{chips} Chips</span>
          </div>
        </div>

        {/* Main Table Area */}
        <div className="w-full flex flex-col items-center p-6 bg-green-100/50">
          {error && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4 w-full rounded shadow-sm">
              <div className="flex items-center">
                <svg
                  className="h-5 w-5 text-red-500 mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <p className="font-medium text-sm">{error}</p>
              </div>
            </div>
          )}

          {!isConnected ? (
            <div className="flex flex-col items-center justify-center py-10 w-full">
              <div className="mb-6 text-center">
                <h2 className="text-xl font-bold text-green-900 mb-2">
                  Welcome to BlackJack
                </h2>
                <p className="text-green-800">
                  Connect your wallet via Warpcast to start playing
                </p>
              </div>
              <button
                className="bg-green-800 hover:bg-green-700 text-white font-medium px-8 py-3 rounded-lg shadow-lg transition duration-200 flex items-center gap-2"
                onClick={() => connect({ connector: connectors[0] })}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  ></path>
                </svg>
                Connect
              </button>
            </div>
          ) : (
            <div className="w-full">
              {/* Game Status Banner */}
              {gameState && (
                <div
                  className={`w-full mb-6 p-3 rounded-lg text-center font-medium ${
                    gameState[3]
                      ? "bg-yellow-100 text-yellow-800 border border-yellow-300"
                      : !gameState[2]
                      ? "bg-red-100 text-red-800 border border-red-300"
                      : "bg-green-100 text-green-800 border border-green-300"
                  }`}
                >
                  {getGameMessage(gameState, status)}
                </div>
              )}

              {/* Game Controls */}
              <div className="flex flex-col items-center w-full">
                {/* Show Start Game only if no gameState or isAlive is false */}
                {(!gameState || (gameState && !gameState[2])) && (
                  <button
                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-8 py-2 rounded-lg shadow mb-4 transition text-lg w-full"
                    onClick={startGameWithPolling}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                        ></path>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path>
                      </svg>
                      Start Game (1 MON)
                    </span>
                  </button>
                )}

                {/* Show Draw Card only if gameState exists, isAlive is true, and hasBlackjack is false */}
                {gameState && gameState[2] && !gameState[3] && (
                  <button
                    className="bg-yellow-400 hover:bg-yellow-500 text-green-900 font-bold px-8 py-2 rounded-lg shadow mb-4 transition text-lg w-full"
                    onClick={handleDrawCardWithPolling}
                    disabled={isDrawing}
                  >
                    {isDrawing ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="animate-spin h-5 w-5 text-green-900"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8z"
                          ></path>
                        </svg>
                        Drawing...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                          ></path>
                        </svg>
                        Draw Card
                      </span>
                    )}
                  </button>
                )}

                {/* Show Reset Game only if gameState exists and isAlive is false */}
                {gameState && !gameState[2] && (
                  <button
                    className="bg-red-500 hover:bg-red-600 text-white font-bold px-8 py-2 rounded-lg shadow mb-4 transition text-lg w-full"
                    onClick={handleResetGame}
                    disabled={isResetting}
                  >
                    {isResetting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="animate-spin h-5 w-5 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8z"
                          ></path>
                        </svg>
                        Resetting...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          ></path>
                        </svg>
                        Reset Game
                      </span>
                    )}
                  </button>
                )}

                {/* New Game button for users who win */}
                {gameState && gameState[3] && (
                  <button
                    className="bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-2 rounded-lg shadow mb-4 transition text-lg w-full"
                    onClick={startGameWithPolling}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                        ></path>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        ></path>
                      </svg>
                      New Game
                    </span>
                  </button>
                )}
              </div>

              {/* Cards Display */}
              {gameState && (
                <div className="flex flex-col items-center mt-4 w-full">
                  <div
                    ref={cardRowRef}
                    className="flex flex-row gap-3 mb-6 transition-all duration-500 justify-center min-h-[120px]"
                  >
                    {gameState[0].map((card: number, idx: number) => (
                      <div
                        key={idx}
                        className={`transition-transform duration-500 ${
                          isDrawing && idx === gameState[0].length - 1
                            ? "animate-bounce"
                            : ""
                        }`}
                        style={{
                          transform: `rotate(${
                            (idx - (gameState[0].length - 1) / 2) * 5
                          }deg)`,
                          transformOrigin: "bottom center",
                          marginTop: Math.abs(
                            (idx - (gameState[0].length - 1) / 2) * 3
                          ),
                        }}
                      >
                        <Image
                          src={getCardImage(card) || "/placeholder.svg"}
                          alt={`Card ${card}`}
                          width={70}
                          height={100}
                          className="rounded-xl shadow-lg bg-white border-2 border-green-800"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Stats Bar */}
                  <div className="grid grid-cols-3 gap-3 w-full mb-4">
                    <div className="flex flex-col items-center bg-white rounded-lg p-3 shadow-md border border-green-200">
                      <span className="text-xs text-green-700 font-medium mb-1">
                        Sum
                      </span>
                      <span
                        className={`text-xl font-bold ${
                          gameState[1] > 21
                            ? "text-red-600"
                            : gameState[1] === 21
                            ? "text-yellow-600"
                            : "text-green-800"
                        }`}
                      >
                        {gameState[1]}
                      </span>
                    </div>
                    <div className="flex flex-col items-center bg-white rounded-lg p-3 shadow-md border border-green-200">
                      <span className="text-xs text-green-700 font-medium mb-1">
                        Status
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          gameState[2] ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {gameState[2] ? "Active" : "Game Over"}
                      </span>
                    </div>
                    <div className="flex flex-col items-center bg-white rounded-lg p-3 shadow-md border border-green-200">
                      <span className="text-xs text-green-700 font-medium mb-1">
                        Blackjack
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          gameState[3] ? "text-yellow-600" : "text-gray-500"
                        }`}
                      >
                        {gameState[3] ? "Yes!" : "No"}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`text-center text-xl font-bold mt-2 ${
                      gameState[3]
                        ? "text-yellow-600"
                        : !gameState[2]
                        ? "text-red-600"
                        : "text-green-800"
                    }`}
                  >
                    {getGameMessage(gameState, status)}
                  </div>
                </div>
              )}

              {!gameState && status && (
                <div className="text-green-900 text-center mt-6 p-4 bg-blue-100 rounded-lg border border-blue-300 font-medium">
                  {status}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 text-green-200 text-xs opacity-80 text-center">
        <div>Built by BossOnormal1</div>
        <div className="mt-1">Powered by Warpcast Mini Apps</div>
      </div>
      <style jsx global>{`
        .animate-bounce {
          animation: bounce 0.8s;
        }
        @keyframes bounce {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(5deg) scale(1.1);
          }
        }
      `}</style>
    </div>
  );
}
