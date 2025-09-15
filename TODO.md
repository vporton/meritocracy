- ICP blockchain, Solana, Bitcoin, BCH payments.

- Connect with BitBucket does not work, connect with ORCID requires a domain to test.

- Require to log-in every 2 months, to avoid dead users.
  Even better let AI checks whether the user is active.

- Confirmation of email, instead of taking emails from GitHub, etc.
  Consider email the same login method, as Ethereum, ORCID, GitHub, etc.

- After failed login, the button text is "Try again". Thus the name of the button is not shown.

- Display GitHub logo on GitHub button instead of an arbitrary Unicode symbol.

- Protect against prompt injections by inserting random strings before and after answers.

- Inefficient checking for whether all dependencies are COMPLETE.

- Remove tasks after finishing.

- `MedianRunner.run` is duplicate code.

- Should we check (with t=0) randomized prompts for accurately representing the original prompt?

- `WorthThresholdCheckRunner` and `MedianRunner` are clearly too complex. Refactor.

- Improve "constantness" of _worth_ answers. Probably, ask more than three times, for the median.

- Probably, we can create secure OAuth in ICP dapp using https://mops.one/liminal -
  If this is the case, we should rewrite this in ICP.

- Add indexes to the DB.

- Check that `customId`s and filenames for OpenAI are unique!

- Delete DB migrations before the release.

- Always run prompt randomization as non-batch, because its cost is low.

- Leaderboard shows wrong values.

- Rewrite Ethereum connection in backend using Viem.

- Don't allow to evaluate a user more than once.

- web3modal (not only MetaMask)
