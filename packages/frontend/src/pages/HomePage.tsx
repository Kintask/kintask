import React from 'react';
import { motion } from 'framer-motion';

// Real Images and Icons (Replace with your own if you have them)
const filecoinImage = 'https://res.coinpaper.com/coinpaper/filecoin_fil_logo_31acf6a7a9.png'; // Filecoin Logo
const recallImage = 'https://imgs.search.brave.com/FfNdCZmHms2k4WRe1Hw1u3xXKW_NcM9-uj14XFWoiCc/rs:fit:500:0:0:0/g:ce/aHR0cHM6Ly9pbWFn/ZS5waXRjaGJvb2su/Y29tL0ZTR0s1cXhz/NlUwMXVzVjdZcG5S/bkZqa0h0YTE3Mzk5/NjMyOTcyNzlfMjAw/eDIwMA.jpeg'; // A recall icon or similar.  REPLACE THIS.  Needs a better icon.
const timelockImage = 'https://img.icons8.com/fluency/96/time-machine.png'; // A time machine icon to represent Timelock Encryption.
const generatorImage = 'https://img.icons8.com/color/96/artificial-intelligence.png'; // AI brain icon
const verifierImage = 'https://img.icons8.com/color/96/verified-account.png'; // Verified account icon
const knowledgeGraphImage = 'https://img.icons8.com/fluency/96/mind-map.png'; // Mind map or knowledge graph icon

// Kintask Logo Path (assuming it's in the public folder)
const kintaskLogoPath = 'kintask-favicon.png'; // Adjust path if needed

const HomePage: React.FC = () => {
  return (
    <div className="bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 text-gray-800 dark:text-gray-200 font-sans antialiased">
      {/* Hero Section */}
      <header className="relative overflow-hidden bg-[#003399] min-h-screen flex flex-col"> {/* Added min-h-screen */}

      {/* Background Logo Image (Centered, Behind Content) */}
      <div className="absolute inset-0 flex items-center justify-center z-0"> {/* Wrapper to help center */}
          <img
            src={kintaskLogoPath} // Assuming this is the path to the logo file
            alt="" // Decorative background
            className="
              w-[600px] h-auto md:w-[900px] lg:w-[1200px] /* Large size */
              max-w-[90vw] max-h-[80vh] /* Prevent excessive size */
              object-contain /* Ensure entire logo is visible */
              rounded-full /* <<< ADDED THIS LINE */

              /* Removed absolute positioning here, handled by parent */
            "
          />
      </div>


      {/* Gradient Overlay - Above logo, below content */}
      <div className="absolute inset-0 bg-gradient-to-r from-kintask-blue/10 to-kintask-blue-light/10 dark:from-kintask-blue/20 dark:to-kintask-blue-light/20 z-10"></div>

      {/* Content Container - Positioned at the Bottom */}
      <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-16 md:pb-20 lg:pb-24"> {/* Positioned bottom, added bottom padding */}
        <div className="container mx-auto"> {/* Centering container */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-center"
          >
            {/* Main Logo (Removed - Assuming you want the subtitle/buttons only at bottom) */}
            {/* If you still want the visible logo here, add the img tag back */}


            {/* Subtitle - Adjust color for contrast if needed */}
            <p className="text-xl md:text-2xl text-gray-200 dark:text-gray-300 mb-10 max-w-3xl mx-auto"> {/* Contrast adjusted for dark blue */}
              Verifiable AI Q&A powered by decentralized technologies
            </p>

            {/* Call to Action Buttons - Adjust colors for contrast if needed */}
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              {/* Get Started Button */}
              <a
                  href="/app"
                  className="
                    inline-block
                    bg-kintask-blue-light hover:bg-opacity-80 /* Adjusted for contrast */
                    text-[#003399] /* Adjusted for contrast */
                    dark:bg-kintask-blue-light dark:hover:bg-opacity-90
                    dark:text-gray-900
                    font-bold py-3 px-8 rounded-full
                    transition-all duration-300 ease-in-out
                    transform hover:scale-105
                    shadow-lg hover:shadow-xl
                    w-full sm:w-auto
                  "
              >
                Get Started
              </a>
              {/* Learn More Button */}
              <a
                  href="#learn-more"
                  className="
                    inline-block
                    border-2 border-kintask-blue-light /* Adjusted for contrast */
                    text-kintask-blue-light /* Adjusted for contrast */
                    dark:border-kintask-blue-light
                    dark:text-kintask-blue-light
                    font-bold py-3 px-8 rounded-full
                    transition-all duration-300 ease-in-out
                    hover:bg-kintask-blue-light/10 dark:hover:bg-kintask-blue-light/10
                    w-full sm:w-auto
                  "
              >
                Learn More
              </a>
            </div>
          </motion.div>
        </div>
      </div>
      </header>
      <main className="container mx-auto px-4">
        {/* Challenge Section */}
        <section id="learn-more" className="py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto text-center"
          >
            <h2 className="text-3xl font-bold mb-6 text-kintask-blue dark:text-kintask-blue-light">
              The Challenge: Trusting AI
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
              Current AI systems often lack transparency. It's hard to know *why* an AI gave a specific answer, and if the
              information it used was accurate. Kintask aims to solve this by creating a more verifiable and trustworthy AI
              Q&A process.
            </p>
          </motion.div>
        </section>

        {/* Components Section */}
        <section className="py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold mb-4 text-kintask-blue dark:text-kintask-blue-light">
              Kintask Components
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Kintask combines several key components to achieve verifiable AI
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "Generator Agent (LLM)",
                description: "This component, powered by a Large Language Model, generates the initial answer to your question.",
                image: generatorImage,
              },
              {
                title: "Verifier Agent",
                description: "The Verifier Agent checks the Generator's answer for accuracy using a reliable Knowledge Graph.",
                image: verifierImage,
              },
              {
                title: "Modular Knowledge Graph",
                description: "The KG is broken down into atomic pieces of information, stored with verifiable origins.",
                image: knowledgeGraphImage,
              },
              {
                title: "Modular Knowledge on Filecoin",
                description: "Knowledge fragments are stored on Filecoin, each with a content identifier (CID) and detailed provenance.",
                image: filecoinImage,
              },
              {
                title: "Verifiable Reasoning on Recall Network",
                description: "The entire reasoning process is logged on the Recall Network, creating an auditable 'chain of thought'.",
                image: recallImage,
              },
              {
                title: "Fair Commitment via Timelock Encryption",
                description: "The Verifier agent commits its preliminary verdict using Timelock Encryption, ensuring fairness.",
                image: timelockImage,
              },
            ].map((component, index) => (
              <motion.div
                key={component.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true }}
              >
                <TutorialCard {...component} />
              </motion.div>
            ))}
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-20 bg-gray-50 dark:bg-gray-800 rounded-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto"
          >
            <h2 className="text-3xl font-bold mb-8 text-center text-kintask-blue dark:text-kintask-blue-light">
              How Kintask Works
            </h2>
            <div className="space-y-6">
              {[
                "A question is submitted to the Generator Agent",
                "The Generator Agent provides an initial answer",
                "The Verifier Agent checks the answer against the Modular Knowledge Graph on Filecoin",
                "The Verifier Agent logs its reasoning steps on the Recall Network",
                "The Verifier Agent commits its final verdict using Timelock Encryption",
                "The final verifiable answer and reasoning trace are available for review",
              ].map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  viewport={{ once: true }}
                  className="flex items-center gap-4 p-4 bg-white dark:bg-gray-700 rounded-lg shadow-sm"
                >
                  <div className="w-8 h-8 rounded-full bg-kintask-blue text-white flex items-center justify-center font-bold">
                    {index + 1}
                  </div>
                  <p className="text-lg">{step}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* CTA Section */}
        <section className="py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl font-bold mb-6 text-kintask-blue dark:text-kintask-blue-light">
              Ready to Experience Verifiable AI?
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
              Join us in building a more trustworthy future for AI
            </p>
            <a
              href="/app"
              className="inline-block bg-kintask-blue hover:bg-kintask-blue-light text-white font-bold py-3 px-8 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg"
            >
              Start Using Kintask
            </a>
          </motion.div>
        </section>
      </main>

      <footer className="bg-gray-100 dark:bg-gray-800 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-gray-600 dark:text-gray-400">
            © {new Date().getFullYear()} Kintask. All rights reserved.
          </p>
        </div>
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
    <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
      <div className="flex flex-col items-center text-center">
        <div className="w-20 h-20 mb-4 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center p-4">
          <img src={image} alt={title} className="w-full h-full object-contain" />
        </div>
        <h3 className="text-xl font-semibold mb-3 text-kintask-blue dark:text-kintask-blue-light">{title}</h3>
        <p className="text-gray-700 dark:text-gray-300">{description}</p>
      </div>
    </div>
  );
};

export default HomePage;