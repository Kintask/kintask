# Kintask: Modular, Attributable & Fair AI Q&A

**Kintask** is an advanced proof-of-concept AI system demonstrating how to build highly trustworthy and verifiable question-answering capabilities using a synergy of decentralized technologies. It features:

1.  A **Generator Agent** (LLM) providing initial answers.
2.  A **Verifier Agent** meticulously checking these answers against a **Modular Knowledge Graph (KG)** composed of individual, provenance-rich fragments stored on **Filecoin**.
3.  A **Commit-Reveal** mechanism using **Timelock Encryption** (via Blocklock) on an L2 blockchain to ensure the Verifier's initial judgment is fair and tamper-proof, managed by the `KintaskCommitment` contract.
4.  A detailed, immutable **Reasoning Trace** logged step-by-step on the **Recall Network**, providing unprecedented transparency into the verification process and linking all components (question, answer, Filecoin fragments, Timelock commit).

## The Problem

Standard LLMs often lack verifiable grounding and can "hallucinate" – producing incorrect or nonsensical information with high confidence. Current AI systems offer little transparency into their reasoning process or the provenance of the information they use. This limits trust and accountability, especially for critical applications. Furthermore, ensuring fairness and preventing manipulation in AI decision-making processes is challenging.

## Our Solution: Kintask

Kintask tackles these issues head-on by integrating best-in-class decentralized technologies:

*   **Modular Knowledge on Filecoin:** Instead of a monolithic block, knowledge is broken down into atomic fragments (facts, rules) stored individually on Filecoin. Each fragment carries its own CID and rich **provenance metadata** (source, curation, confidence, cross-chain attestations). This provides a verifiable, granular, and efficient foundation for truth.
*   **Verifiable Reasoning on Recall:** The Verifier agent logs its *entire* multi-step reasoning process to the Recall Network – from identifying needed knowledge fragments (Filecoin CIDs) to applying logic, checking provenance, and calculating confidence. This creates an immutable, auditable "chain of thought."
*   **Fair Commitment via Timelock Encryption:** Before revealing its detailed reasoning, the Verifier agent cryptographically commits its preliminary verdict using Timelock Encryption on an L2 chain via the `KintaskCommitment` contract. The commitment transaction ID is logged to Recall. The verdict can only be decrypted after a short delay, preventing manipulation and ensuring fairness.
*   **Synergy:** Filecoin provides the *verifiable data*, Recall provides the *verifiable process*, and Timelock Encryption provides the *verifiable commitment*, creating a holistic trust layer for AI Q&A.

## Architecture Diagram (Kintask)

graph LR
    subgraph "User Browser (React Frontend)"
        UI[Chat Interface] -- 1. Ask Question --> APIClient[API Client (axios)]
    end

    subgraph "Backend Server (Node.js/Express)"
        APIClient -- 2. POST /api/verify --> Routes[/api/verify route]
        Routes -- 3. --> Controller[Verify Controller]
        Controller -- 4. Question --> Generator[Generator Service (OpenAI)]
        Generator -- 5. Answer --> Controller
        Controller -- 6. Q+A --> Verifier[Verifier Service]

        subgraph "Verification Process within Verifier Service"
            Verifier -- 7. Identify Needed Knowledge --> Index[KG Index (local/cached)]
            Index -- 8. Get Relevant CIDs --> Verifier
            Verifier -- 9. Fetch Fragments (by CIDs) --> FilecoinSvc[Filecoin Service (Web3.storage)]
            FilecoinSvc -- 10. KG Fragments w/ Provenance --> Verifier
            Verifier -- 11. Perform Logic -> Preliminary Verdict --> TimelockSvc[Timelock Service (Blocklock)]
            TimelockSvc -- 12. Encrypt Verdict --> TimelockSvc
            TimelockSvc -- 13. Commit Tx --> L2Contract[(KintaskCommitment on L2)]
            L2Contract -- 14. RequestID --> TimelockSvc
            TimelockSvc -- 15. Timelock RequestID --> Verifier
            Verifier -- 16. Log Reasoning Steps w/ CIDs & RequestID --> RecallSvc[Recall Service]
            RecallSvc -- 17. Multi-step Log --> RecallNet[(Recall Network)]
            RecallNet -- 18. Log Confirmations --> RecallSvc
            Verifier -- 19. Final Verdict, Used CIDs, RequestID --> Controller
        end

        Controller -- 20. Final Response --> Routes
        Routes -- 21. JSON Response --> APIClient
    end

    subgraph "Asynchronous Reveal (Backend Listener / Separate Process)"
        L2Contract -- 22. receiveBlocklock Callback (after delay) --> Listener[Timelock Listener Service]
        Listener -- 23. Decrypt Verdict --> Listener
        Listener -- 24. Log Reveal to Recall --> RecallSvc
    end

    APIClient -- 25. Display Result w/ Links & Trace --> UI

