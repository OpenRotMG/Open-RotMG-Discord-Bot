# The Most Important Rules for Writing Code

Your work should be _good_. That means, in this order:
1/ Minimal LoC to do the job
2/ Testabiltiy
3/ Strong observability
4/ Proper architecture that maximizes reliability and minimizes fallbacks

# Tips on Reducing LoC

When doing any work, consider - "Can I reduce LoC in mr PR?". Here are some ways to do that:
1/ Investigate the relevant code, and consider: "If I were reimplementing this architecture knowing what I know now, what can I delete and rewrite to reduce the LoC?"
2/ Before sending the PR, consider - "What tests did I only need to get here, and what can I delete?", or "What documentation did I see that was irrelevant, and can delete?"
3/ Do not add any documentation unless explcitly asked. When writing documentation, have a subagent delete 75% of it after, and simply confirm if that captures mostly what you wanted to get across.

