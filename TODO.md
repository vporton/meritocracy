- TODO@P3 ICP blockchain, Solana, Bitcoin, BCH payments.

- TODO@P3 Connect with BitBucket and GitLab doesn't work.

- TODO@P2 Require to log-in every 2 months, to avoid dead users.
  Even better let AI checks whether the user is active.

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

- TODO@P2 Delete DB migrations before the release.

- TODO@P3 Always run prompt randomization as non-batch, because its cost is low.

- TODO@P3 Give back token like GIV of Giveth.

- TODO@P2 Delete disconnected accounts. However, don't delete bans.

- TODO@P3 Don't allow worth assessment, when only KYC and/or Ethereum connected.

- TODO@P3 When email is confirmed, the Connect Email button should change from "Waiting from Email"
  to "Disconnect Email" state through browser inter-windows communication.

- TODO@P3 Should the user be able to add more than one email?
