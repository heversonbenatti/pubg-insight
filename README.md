Features

    Search for PUBG players by name. 
    Display stats for different game modes (Solo, Duo, Squad). 
    Display important statistics such as K/D ratio, win rate, average damage, and more. 
    Support for selecting different seasons.

Prerequisites

    Node.js (version 14.x or later)
    npm (comes with Node.js)

Installation

1. Clone the repository

       git clone https://github.com/heversonbenatti/pubg-insight.git

2. Install dependencies

       npm install

3. Set up environment variables

       Create a .env file in the root of the project and add your PUBG API key.
       API_KEY=your_pubg_api_key_here

4. Run the server

       npm start
       By default, the server will run on http://localhost:3000.

Usage

    Open the application in your browser at http://localhost:3000.
    Enter a player name, select a season, and choose if you want FPP or TPP stats.
    Click the "Search" button to fetch and display the player's stats.

Main branch: Stable and tested code ready for production.

Develop branch: Used for testing and staging new features. Ensure to commit and push changes to this branch before merging to the main branch.


License

This project is licensed under the MIT License.
