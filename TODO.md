- TODO@P3 ICP blockchain, Solana, Bitcoin, BCH payments.

- TODO@P3 Connect with BitBucket and GitLab doesn't work.

- TODO@P2 Require to log-in every 2 months, to avoid dead users.
  Even better let AI checks whether the user is active.

- TODO@P1 Confirmation of email, instead of taking emails from GitHub, etc.
  Consider email the same login method, as Ethereum, ORCID, GitHub, etc.

- FIXME@P2 After failed login, the button text is "Try again". Thus the name of the button is not shown.

- TODO@P3 Display GitHub logo on GitHub button instead of an arbitrary Unicode symbol.

- TODO@P2 Protect against prompt injections by inserting random strings before and after answers.

- TODO@P3 Inefficient checking for whether all dependencies are COMPLETE.

- TODO@P3 Remove tasks after finishing.

- TODO@P3 `MedianRunner.run` is duplicate code.

- TODO@P3 Should we check (with t=0) randomized prompts for accurately representing the original prompt?

- TODO@P3 Improve "constantness" of _worth_ answers. Probably, ask more than three times, for the median.
  Also use running average of user worth to reduce used AI tokens.

- TODO@P2 Probably, we can create secure OAuth in ICP dapp using https://mops.one/liminal -
  If this is the case, we should rewrite this in ICP.

- TODO@P1 Add indexes to the DB.

- TODO@P1 Check that `customId`s and filenames for OpenAI are unique!

- TODO@P2 Delete DB migrations before the release.

- TODO@P3 Always run prompt randomization as non-batch, because its cost is low.

- FIXME@P2 Leaderboard shows wrong values.

- TODO@P2 Rewrite Ethereum connection in backend using Viem.

- TODO@P2 web3modal (not only MetaMask)

- TODO@P2 Merge the history, when merging accounts.

- FIXME@P1 If user disconnect (all) his/her accounts, he gets rid of a ban. This is a security vulnerability.

- TODO@P3 Give back token like GIV of Giveth.

- TODO@P2 Delete disconnected accounts. However, don't delete bans.

- FIXME@P2 A user can create two accounts with non-overriding connections.
  However, the AI may decide that it is the same user and reward him/her multiple times.
  Solvable by KYC.

- TODO@P3 Add KYC to catch fraudsters. https://business.didit.me/console is free KYC!
