/**
 * CA-themed icebreaker prompts for the chat feature.
 */
const icebreakers = [
  "If you could audit any company in the world, which one would you pick and why?",
  "What's the funniest thing that happened during your articleship?",
  "One CA exam tip you wish someone told you earlier?",
  "Big 4 or boutique firm — what's your vibe and why?",
  "If chartered accountants had a dating app, what would the tagline be?",
  "What's your go-to comfort food during exam season?",
  "Describe your CA journey in three words.",
  "What's the most satisfying balance sheet you've ever worked on?",
  "If you weren't a CA, what would you be doing right now?",
  "GST return filing at midnight — relatable or not?",
  "What's one non-CA hobby that keeps you sane?",
  "Your favourite accounting standard and why? (Yes, this is a valid question.)",
  "Rank these: Tax season stress vs. Exam result day stress.",
  "What's your hot take on the current CA syllabus?",
  "If you could remove one subject from the CA exam, which would it be?",
  "Coffee or chai during late-night study sessions?",
  "What's the best perk of working in a Big 4?",
  "Tell me about your worst (or best) encounter with a client.",
  "What's one financial ratio that describes your personality?",
  "If CA exams were a Bollywood movie, which one would they be?",
  "Do you have a lucky pen/calculator for exams?",
  "What motivated you to pursue CA?",
  "Share a CA meme that lives rent-free in your head.",
  "What's the most underrated branch of accounting?",
  "Would you rather do a 100-page audit report or a 3-hour viva?",
  "What's your study playlist genre?",
  "First thing you did after passing your last CA exam?",
  "What's your dream firm/company to work at?",
  "Articleship: best days or toughest days?",
  "If you could have dinner with any finance legend, who would it be?",
];

/**
 * Return a random subset of icebreaker prompts.
 * @param {number} count – how many to return (default 3, max 5)
 */
const getRandomIcebreakers = (count = 3) => {
  const n = Math.min(Math.max(count, 1), 5);
  const shuffled = [...icebreakers].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
};

module.exports = { icebreakers, getRandomIcebreakers };
