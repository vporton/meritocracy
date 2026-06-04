- Against prompt injection add random strings to output and JSON labels.

- Use a defense pattern similar to that in the 2025 paper Robustness via Referencing: ask the LLM to tag which part of its output corresponds to which instruction, then reject outputs that reference instructions not issued by your system.

- More secure prompts: https://chatgpt.com/s/t_696d6def807c8191a8b9f09fc4000906
