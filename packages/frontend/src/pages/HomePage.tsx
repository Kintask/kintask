import React from 'react';

// Real Images and Icons (Replace with your own if you have them)
const filecoinImage = 'https://cryptologos.cc/logos/filecoin-fil-logo.png?v=029'; // Filecoin Logo
const recallImage = 'https://img.icons8.com/color/96/recall--v1.png'; // A recall icon or similar.  REPLACE THIS.  Needs a better icon.
const timelockImage = 'https://img.icons8.com/fluency/96/time-machine.png'; // A time machine icon to represent Timelock Encryption.
const generatorImage = 'https://img.icons8.com/color/96/artificial-intelligence.png'; // AI brain icon
const verifierImage = 'https://img.icons8.com/color/96/verified-account.png'; // Verified account icon
const knowledgeGraphImage = 'https://img.icons8.com/fluency/96/mind-map.png'; // Mind map or knowledge graph icon

const HomePage: React.FC = () => {
  return (
    <div className="bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 font-sans antialiased">
      <header className="bg-white dark:bg-gray-800 shadow-md py-6">
        <div className="container mx-auto px-4">
          <h1 className="text-3xl font-bold text-center text-kintask-blue dark:text-kintask-blue-light">
            Kintask: Verifiable AI Q&A Tutorial
          </h1>
          <p className="text-lg text-center text-gray-600 dark:text-gray-400 mt-2">
            Learn how Kintask uses decentralized technologies for trustworthy AI.
          </p>
        </div>
      </header>

      <main className="container mx-auto py-12 px-4">
        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-kintask-blue dark:text-kintask-blue-light">
            1. The Challenge: Trusting AI
          </h2>
          <p className="mb-4">
            Current AI systems often lack transparency. It's hard to know *why* an AI gave a specific answer, and if the
            information it used was accurate. Kintask aims to solve this by creating a more verifiable and trustworthy AI
            Q&A process.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-kintask-blue dark:text-kintask-blue-light">
            2. Kintask Components
          </h2>
          <p className="mb-4">
            Kintask combines several key components to achieve verifiable AI. Let's explore each one:
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Generator Agent */}
            <TutorialCard
              title="Generator Agent (LLM)"
              description="This component, powered by a Large Language Model, generates the initial answer to your question."
              image={generatorImage}
            />

            {/* Verifier Agent */}
            <TutorialCard
              title="Verifier Agent"
              description="The Verifier Agent checks the Generator's answer for accuracy using a reliable Knowledge Graph."
              image={verifierImage}
            />

            {/* Modular Knowledge Graph */}
            <TutorialCard
              title="Modular Knowledge Graph"
              description="The KG is broken down into atomic pieces of information, stored with verifiable origins."
              image={knowledgeGraphImage}
            />

            {/* Filecoin Storage */}
            <TutorialCard
              title="Modular Knowledge on Filecoin"
              description="Knowledge fragments are stored on Filecoin, each with a content identifier (CID) and detailed provenance."
              image={filecoinImage}
            />

            {/* Recall Network Reasoning Trace */}
            <TutorialCard
              title="Verifiable Reasoning on Recall Network"
              description="The entire reasoning process is logged on the Recall Network, creating an auditable 'chain of thought'."
              image={recallImage}
            />

            {/* Timelock Encryption */}
            <TutorialCard
              title="Fair Commitment via Timelock Encryption"
              description="The Verifier agent commits its preliminary verdict using Timelock Encryption, ensuring fairness."
              image={timelockImage}
            />
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-2xl font-semibold mb-4 text-kintask-blue dark:text-kintask-blue-light">
            3. How Kintask Works: A Step-by-Step Guide
          </h2>
          <p className="mb-4">
            Kintask works through a series of steps to provide verifiable answers:
          </p>

          <ol className="list-decimal pl-6 space-y-4">
            <li>
              A question is submitted to the <strong>Generator Agent</strong>.
            </li>
            <li>
              The <strong>Generator Agent</strong> provides an initial answer.
            </li>
            <li>
              The <strong>Verifier Agent</strong> checks the answer against the <strong>Modular Knowledge Graph on Filecoin</strong>.
            </li>
            <li>
              The <strong>Verifier Agent</strong> logs its reasoning steps on the <strong>Recall Network</strong>.
            </li>
            <li>
              The <strong>Verifier Agent</strong> commits its final verdict using <strong>Timelock Encryption</strong>.
            </li>
            <li>
              The final verifiable answer and reasoning trace are available for review.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-kintask-blue dark:text-kintask-blue-light">
            4. Next Steps
          </h2>
          <p>Ready to explore the Kintask app?</p>
          <a
            href="/app"
            className="inline-block mt-4 bg-kintask-blue hover:bg-kintask-blue-light text-white font-bold py-2 px-4 rounded"
          >
            Go to the App
          </a>
        </section>
      </main>

      <footer className="bg-gray-100 dark:bg-gray-800 py-4 text-center text-gray-500 dark:text-gray-400">
        <p>© {new Date().getFullYear()} Kintask. All rights reserved.</p>
      </footer>
    </div>
  );
};

interface TutorialCardProps {
  title: string;
  description: string;
  image: string;
}

const TutorialCard: React.FC<TutorialCardProps> = ({ title, description, image }) => {
  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
      <img src={image} alt={title} className="mb-4 rounded-lg w-24 h-24" />
      <h3 className="text-xl font-semibold mb-2 text-kintask-blue dark:text-kintask-blue-light">{title}</h3>
      <p className="text-gray-700 dark:text-gray-300">{description}</p>
    </div>
  );
};

export default HomePage;