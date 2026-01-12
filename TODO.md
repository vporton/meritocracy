- TODO@P2 Against prompt injection add random strings to output and JSON labels.

- TODO@P3 ICP blockchain, Solana, Bitcoin, BCH, GLRM payments.

- TODO@P2 Require to check liveliness every 2 months (provided that the salary is not zero), to avoid dead users.

- TODO@P3 Display GitHub logo on GitHub button instead of an arbitrary Unicode symbol.

- TODO@P3 Inefficient checking for whether all dependencies are COMPLETE.

- TODO@P3 Remove tasks after finishing.

- TODO@P3 Should we check (with t=0) randomized prompts for accurately representing the original prompt?

- TODO@P3 Improve "constantness" of _worth_ answers. Probably, ask more than three times, for the median.
  Also use running average of user worth to reduce used AI tokens.

- TODO@P2 Probably, we can create secure OAuth in ICP dapp using https://mops.one/liminal -
  If this is the case, we should rewrite this in ICP. Use ZenDB to replace SQL.

- TODO@P2 Delete DB migrations before the release.

- TODO@P3 Always run prompt randomization as non-batch, because its cost is low.

- TODO@P3 Give back token like GIV of Giveth.

- TODO@P3 Delete disconnected accounts, when disconnect, not in Cron.

- TODO@P3 When email is confirmed, the Connect Email button should change from "Waiting from Email"
  to "Disconnect Email" state through browser inter-windows communication.

- TODO@P3 Should the user be able to add more than one email?

- TODO@P3 Allow to enter a blockchain address instead of using a wallet.

- TODO@P2 Logging displayed at `/logs` is excessive.

- TODO@P3 Allow the user to delay distribution to them, to decrease gas spendings.
          Subtract gas cost from user.

- TODO@P3 Donation to the system through MetaMask et al.

- Make our AI to summarize each time when it asserts worth and save work and/or go further building on it the next time.

- TODO@P2 User email should be passed to AI.

- TODO@P3 Option to donate back to AIIM automatically.

- TODO@P2 Deleting user data.

- FIXME@P2 `[Bitcoin] Failed to import private key:`.
  This  is a part of a bigger problem: Bitcoin integration should not use Wallet API.
  See also https://chatgpt.com/s/t_69264d948c548191bf2db7cc41c1dfbf

- TODO@P3 An automatic system for pick-checking honesty of the Join Proxy installation to prevent fraud with the JP.

- TODO@P3 https://DonateHelper.com for requesting donations from Russia.

- TODO@P3 Funds for individual countries, disbursed, when the user migrates.

- TODO@P3 Ability to re-onboard a user, especially if his/her account was empty.

- TODO@P3 Less info on homepage.

- TODO@P3 Show all blockchains before loading balances and gas prices. Obtain them in parallel.

- TODO@P2 Use a defense pattern similar to that in the 2025 paper Robustness via Referencing: ask the LLM to tag which part of its output corresponds to which instruction, then reject outputs that reference instructions not issued by your system.

- TODO@P3 Claude as an alternative with up to 75% discount: https://www.anthropic.com/news/claude-for-nonprofits

- TODO@P3 Repeat KYC time-to-time.

- FIXME@P2 Connecting with Ethereum sometimes fails without prompting for signature.

- TODO@P3 We can reduce GitHub actions minutes without increasing the price of hosting
  by `fly --local-only` (if I remember option name correctly), with additional option to do testing in Docker due deployment.

- TODO@P2 When switching Global/national fund, immediately remove blockchain addresses from the screen,
  not to confuse the user.

- FIXME@P2 When I opened it in a private browser window, it displayed error 401 retrieving world GDP
  (F5 helped).

- FIXME@P3 It doesn't fit width of my phone screen, apparently because of the leaderboard table.
