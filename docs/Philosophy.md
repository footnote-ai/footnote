# Philosophy

AI can be helpful. It can also sound sure of itself when it's guessing.

That gap matters.

When an AI gives you an answer, you usually see only the finished response. You don't see which information it relied on, what instructions shaped it, whether it used a tool, remembered an earlier conversation, checked its own work, or quietly filled in a gap. Footnote is our attempt to make that relationship more honest.

We want AI that can explain what shaped an answer, work within limits the user understands, and leave room for a person to disagree. Here's the goal, in plain language:

> **People should be able to see what their AI is doing and remain in charge of it.**

Footnote is still being built. Some of what follows already exists in the software; some of it is the direction we're headed — promises we want the project to grow into.

## An answer should come with receipts

Imagine asking a friend where they heard something. A useful answer might be, "I read it on the city website this morning." A less useful one is, "Trust me."

AI should be held to the same basic standard. For anything that matters, you should be able to find out where the information came from, which tools were used, what assumptions were made, and what the system wasn't sure about — and you shouldn't need to be a programmer to follow along.

The [OECD AI Principles](https://oecd.ai/en/ai-principles) call for "plain and easy-to-understand information" about the sources and processes behind an AI result, and say people should have enough of it to challenge that result. That's close to what we mean by a **checkable answer**.

A Footnote response should help you answer a few ordinary questions: Where did this come from? What did the AI do? What was it unsure about? What would change the answer?

A casual conversation may need only a small note. A factual or sensitive one may need sources, checks, and a fuller record. We want the detail there when it matters, without turning every chat into paperwork.

### More than citations

A citation tells you where a claim came from. That's useful, but an answer can be shaped by much more than a source.

The AI may have searched the web, read a saved document, used a calculator, followed a special rule, asked another model for review, or remembered something from an earlier conversation. All of that is part of what we call **provenance** — the wider record of how an answer came to be. The World Wide Web Consortium describes it as information about the "entities, activities, and people involved in producing a piece of data or thing."

For Footnote, that can mean the sources and memories it drew on, the model and tools it used, the settings in effect, any checks or revisions along the way, actions it took outside the chat, and gaps it knows are still there.

The small footnote under an answer is the readable version of that record. Deeper technical detail can stay there for people who want it.

## Staying in control

### Permission should be clear

There's a big difference between asking an assistant to suggest an email and letting it send one. The same is true for reading a file, remembering personal information, spending money, changing a calendar, or contacting another person — each step hands the software more authority.

Footnote should make those steps visible. A user should be able to decide what the assistant may do, which information it may use, what it may remember, and when it must ask first. Important permissions should be enforced by the software itself; a sentence buried in an AI prompt is too fragile to serve as a lock.

We also want these choices to be reversible. You should be able to turn memory off, remove a tool, change providers, lower a spending limit, or take back permission you already gave.

The amount of care should match the amount of authority involved. Changing the page background needs little discussion. Giving an AI access to your files, or letting it act on your behalf, deserves more.

Footnote is mainly being built for individuals right now, and we don't need to wrap personal software in the rituals of a large company. We do need to keep asking:

> **What can this feature do, what happens when it goes wrong, and how does the user stop it?**

### People need a way to correct it

AI will make mistakes. Good design starts by accepting that.

Microsoft's research-backed guidelines for human-AI software include a practical instruction:

> "Make it easy to edit, refine, or recover when the AI system is wrong."

We agree.

A thumbs-down button isn't enough. A user may need to correct a fact, remove a memory, challenge an assumption, question why a tool was used, or report that the assistant acted beyond its permission — and that correction should reach further than the wording on the screen. Where possible, the system should show what went wrong and let the user change the rule, memory, or setting that caused it.

The [Council of Europe's AI Convention](https://www.coe.int/en/web/artificial-intelligence/the-framework-convention-on-artificial-intelligence) goes further than asking systems to explain themselves: it says people should get enough information to challenge both a decision and the use of the AI system behind it.

Footnote isn't a court or a public agency. Still, the principle carries over well — people should have some power after an AI gets something wrong.

### Human oversight should mean something

It's easy to say a human is "in the loop." Sometimes that only means a person was standing nearby while the computer made the real decision.

Meaningful oversight requires three things: the person can understand what's happening, the person can step in, and the person has the authority to stop it. The European Union's AI Act uses similar language for high-risk systems — overseers should understand a system's abilities and limits, interpret its output, and be able to interrupt it safely.

Most Footnote conversations will never come close to that level of risk. The same common-sense rule still applies: a review button, an approval step, or a safety control should give the user real power.

Footnote can gather information, compare viewpoints, flag uncertainty, and help someone think. The final judgment still belongs to a person.

UNESCO puts this plainly:

> "AI systems should not displace ultimate human responsibility and accountability."

## Values and responsibility

### Values should be visible

Every AI system makes choices. Someone decides what the model is taught, which behaviour gets rewarded, what it refuses, which sources it searches, and what its interface nudges people to do. Defaults carry values too, and Footnote should be honest about that.

We want the system to make room for more than one way of thinking, especially on questions of ethics, politics, relationships, or competing responsibilities — one person weighing rights, another weighing harm, fairness, duty, freedom, care, or the good of the wider community. Looking at a question through more than one of those lenses can surface something a single answer would miss.

None of that means anything goes. Footnote is committed to human rights, and it rejects uses tied to torture, genocide, forced labour, or coercive state violence — commitments spelled out more fully in our [licensing strategy](./LICENSE_STRATEGY.md).

We'd rather say what we value than hide behind a claim of neutrality.

### Ethical failures belong in the security conversation

A security problem is usually understood as stolen data, a broken login, or someone gaining access they shouldn't have. With AI, the boundary is wider: a system can be manipulated into using the wrong tool, leaking remembered information, following hostile instructions, or taking action outside the user's permission. It can even produce a false record of what happened afterward.

Footnote treats security, privacy, provenance, and ethical safety as one connected concern, and our [security policy](../SECURITY.md) is written to let people report any of them.

We still draw a line between a poor answer and a serious incident. A clumsy sentence is a quality problem. Leaking private information or acting outside its permissions is a security incident.

When a serious failure happens, we want enough of a record to understand it, fix it, and make the same failure less likely next time.

## Freedom and ownership

### Users should be able to leave

Control also means freedom from the project itself. People should be able to run Footnote on hardware they control, use local models where practical, export important records, and switch providers without starting their digital life over.

Hosted services will often be easier, and some commercial models will be better at certain jobs — but local software brings its own setup, cost, and limits. Footnote doesn't need one answer for everyone. The choice should belong to the user.

This is one reason we care about open development. The code, major decisions, policies, and limitations should be available for inspection. Publishing code alone is only a beginning — self-hosting and moving your data also need to be realistic for ordinary people.

No model company or agent framework should become the permanent centre of Footnote. We want to use strong outside tools while keeping the rules, permissions, and record of what happened under Footnote's own control.

### Licensing and its tension

Footnote is developed openly and uses the MIT and Hippocratic License terms described in our [licensing documentation](./LICENSE_STRATEGY.md). Those licences come from two different traditions: MIT gives people broad freedom to use and change the software, while the Hippocratic License places human-rights conditions on its use. The [Open Source Definition](https://opensource.org/osd), meanwhile, says an open-source licence can't restrict a field of work.

That's a genuine tension, and we shouldn't hide it behind cheerful language. We value open development, source code people can inspect and modify, self-hosting, and community participation. We also believe some uses cross a line a responsible project should name.

Our licence documents need to explain that position precisely. This page can state the reason behind it: technical freedom matters, and so does responsibility for how technology is used.

## We are building on other people's work

Footnote did not invent transparency, provenance, human oversight, or responsible AI. The project draws on several areas of existing work:

- [W3C PROV](https://www.w3.org/TR/prov-overview/) gives us a shared language for tracing where information came from and how it changed.
- [Model Cards](https://research.google/pubs/model-cards-for-model-reporting/) and [Datasheets for Datasets](https://www.microsoft.com/en-us/research/publication/datasheets-for-datasets/) show how models and data can carry clearer records of their purpose and limits.
- The [Microsoft Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) focus on what people need when an AI is introduced, makes mistakes, and changes over time.
- [NIST](https://www.nist.gov/itl/ai-risk-management-framework) and international bodies such as the OECD, UNESCO, and the Council of Europe cover the broader ground of risk, rights, accountability, and human control.

These efforts address different parts of the same problem. Footnote focuses on the interaction as a whole: what entered, what acted, what rules applied, and what reached the user.

We expect this section to grow. The project should keep naming the work it learns from and stay open to ideas developed elsewhere.

## What we ask while building

These ideas have to affect the code. For any feature with real power, we ask the same handful of questions: What is it allowed to do? Will the user understand that? What record will remain? Can the user stop, reverse, or correct it? Does it make Footnote harder to leave?

Not every decision needs a grand ethical debate. These questions are here to catch the moments when a small technical change quietly gives the system more authority.

## What success looks like

Footnote is working when someone can use AI without treating it like an oracle. They can see where an important answer came from, choose what the assistant is allowed to do, and correct it when it's wrong. They can change models, providers, and settings without giving up ownership, and when something serious does fail, there's enough of a record to make sense of it.

> **Footnote is not an attempt to make AI unquestionable. It is an attempt to make questioning it part of the system.**
