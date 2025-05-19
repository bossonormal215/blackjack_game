import React from 'react';

const BlackjackGame: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
            <h1 className="text-4xl font-bold mb-8">Blackjack</h1>
            <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-4">
                Start Game
            </button>
            <div className="mt-4">
                <p>Game State: Not Started</p>
            </div>
        </div>
    );
};

export default BlackjackGame;
