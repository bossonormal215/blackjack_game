import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("Blackjack", function () {
  let blackjack: Contract;
  let owner: Signer;
  let player: Signer;
  let entropy: string;
  let provider: string;

  beforeEach(async function () {
    [owner, player] = await ethers.getSigners();
    // Use the real Pyth Entropy address for Monad testnet, but for local test, just use a random address
    entropy = ethers.Wallet.createRandom().address;
    provider = ethers.Wallet.createRandom().address;
    const Blackjack = await ethers.getContractFactory("Blackjack");
    blackjack = await Blackjack.deploy(entropy, provider);
    await blackjack.waitForDeployment();
  });

  it("should deploy and initialize a new game", async function () {
    // Start a game as player
    const playerAddress = await player.getAddress();
    const userRandomNumber = ethers.utils.formatBytes32String("seed1");
    // Mock the fee to 0 for test (assume entropy.getFee returns 0)
    // Call startGame as player
    await expect(
      (blackjack as any).connect(player).startGame(userRandomNumber, { value: 0 })
    ).to.emit(blackjack, "GameStarted");
    // Simulate entropy callback (normally called by entropy contract)
    // We'll use a random number for the test
    const sequenceNumber = 1; // In real use, this would be tracked
    const randomNumber = ethers.utils.formatBytes32String("rand");
    // Manually set the request mapping for test (test-only, bypass type)
    await (blackjack as any).requests(sequenceNumber, {
      player: playerAddress,
      requestType: 0, // StartGame
    });
    // Call testEntropyCallback (public test helper)
    await (blackjack as any).connect(owner).testEntropyCallback(
      sequenceNumber,
      ethers.constants.AddressZero,
      randomNumber
    );
    // Check game state
    const [cards, sum, isAlive, hasBlackjack, chips] = await (blackjack as any).getGameState(playerAddress);
    expect(cards.length).to.equal(2);
    expect(isAlive).to.be.true;
    expect(chips).to.equal(200);
  });

  it("should allow drawing a card and update state", async function () {
    const playerAddress = await player.getAddress();
    const userRandomNumber = ethers.utils.formatBytes32String("seed2");
    // Start game
    await (blackjack as any).connect(player).startGame(userRandomNumber, { value: 0 });
    // Simulate entropy callback for startGame
    const seqStart = 1;
    const randStart = ethers.utils.formatBytes32String("rand1");
    await (blackjack as any).requests(seqStart, {
      player: playerAddress,
      requestType: 0,
    });
    await (blackjack as any).connect(owner).testEntropyCallback(
      seqStart,
      ethers.constants.AddressZero,
      randStart
    );
    // Draw card
    await (blackjack as any).connect(player).drawCard(userRandomNumber, { value: 0 });
    // Simulate entropy callback for drawCard
    const seqDraw = 2;
    const randDraw = ethers.utils.formatBytes32String("rand2");
    await (blackjack as any).requests(seqDraw, {
      player: playerAddress,
      requestType: 1,
    });
    await (blackjack as any).connect(owner).testEntropyCallback(
      seqDraw,
      ethers.constants.AddressZero,
      randDraw
    );
    // Check game state
    const [cards, sum, isAlive, hasBlackjack, chips] = await (blackjack as any).getGameState(playerAddress);
    expect(cards.length).to.equal(3);
    expect(isAlive).to.be.true;
    expect(chips).to.equal(200);
  });
});
