// Word helpers + the default set of 25 medium-level words, each with 3 hints (vague → helpful).
const crypto = require('crypto');

const cleanWord = (w) => String(w || '').toUpperCase().replace(/[^A-Z \-]/g, '').replace(/\s+/g, ' ').replace(/^[ -]+|[ -]+$/g, '');
const normalize = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
const letterIdx = (word) => [...word].map((c, i) => (/[A-Z]/.test(c) ? i : -1)).filter((i) => i >= 0);

// Reveal ~30% of letters, always including the first, spread across the word.
function autoReveal(word) {
  const L = letterIdx(word);
  const n = Math.min(L.length - 2, Math.max(1, Math.round(L.length * 0.3)));
  const picked = new Set([L[0]]);
  const step = L.length / n;
  for (let k = 1; k < n; k++) {
    const lo = Math.floor(k * step);
    const hi = Math.max(lo, Math.floor((k + 1) * step) - 1);
    picked.add(L[Math.min(L.length - 1, lo + crypto.randomInt(0, hi - lo + 1))]);
  }
  return [...picked].sort((a, b) => a - b);
}

// [word, category, hint1, hint2, hint3]
const DEFAULT_WORDS = [
  ['NEGOTIATION', 'Business', 'Discussion aimed at reaching an agreement', 'Common between buyers and sellers, or unions and employers', 'Often called the "give and take" at the bargaining table'],
  ['ENTREPRENEUR', 'Business', 'Someone who starts a business and takes on its financial risk', 'Startup founders are often called this', 'From a French word meaning "one who undertakes"'],
  ['BENCHMARK', 'Business', 'A standard against which performance is measured', 'Companies compare themselves with competitors using one', 'Originally a surveyor’s reference mark cut into stone'],
  ['LIABILITY', 'Finance', 'Something a company owes', 'It sits opposite assets on a balance sheet', 'Loans and unpaid bills are examples'],
  ['INFLATION', 'Finance', 'A general rise in prices over time', 'It reduces the purchasing power of money', 'The RBI raises interest rates to keep it in check'],
  ['MILESTONE', 'Work', 'A significant stage in the progress of a project', 'Project plans and client payments are often tied to these', 'Originally a roadside stone showing the distance in miles'],
  ['ITINERARY', 'Travel', 'A planned schedule for a journey', 'Travel agents send you one before a trip', 'It lists your flights, hotels and day-by-day plans'],
  ['ARCHIPELAGO', 'Geography', 'A group or chain of islands', 'Indonesia and the Philippines are well-known examples', 'Lakshadweep and the Andaman & Nicobar Islands are Indian examples'],
  ['EQUATOR', 'Geography', 'An imaginary line around the middle of the Earth', 'It lies at 0° latitude', 'It divides the Northern and Southern Hemispheres'],
  ['MONSOON', 'Geography', 'A seasonal shift in wind that brings heavy rain', 'In India it usually reaches Kerala first, around early June', 'Farmers across India depend on it for their crops'],
  ['PHOTOSYNTHESIS', 'Science', 'A process that happens inside green leaves', 'It uses sunlight, water and carbon dioxide', 'Plants make their food this way and release oxygen'],
  ['ECOSYSTEM', 'Science', 'Living things interacting with each other and their surroundings', 'A forest, a pond or a coral reef is an example', 'Tech companies also use the word for a network of partners and platforms'],
  ['CONSTELLATION', 'Science', 'A group of stars seen from Earth', 'The stars form a recognisable pattern in the night sky', 'Orion and Ursa Major (the Great Bear) are famous examples'],
  ['QUARANTINE', 'Health', 'A period of isolation', 'Used to stop an infectious disease from spreading', 'From the Italian for "forty days"'],
  ['DEMOCRACY', 'Civics', 'A system of government', 'Citizens choose their leaders through elections', 'India is the world’s largest one'],
  ['RENAISSANCE', 'History', 'A period of renewed interest in art and learning', 'It began in Italy in the 14th century and spread across Europe', 'Leonardo da Vinci and Michelangelo are its most famous artists'],
  ['AMBIGUOUS', 'Language', 'Open to more than one interpretation', 'The opposite of clear or definite', 'A sentence that could mean two different things is this'],
  ['PROCRASTINATE', 'Language', 'A habit many people struggle with', 'To keep delaying something you should be doing', '"I’ll do it tomorrow" is the classic example'],
  ['CAMOUFLAGE', 'Nature', 'A way of hiding in plain sight', 'It helps an animal blend into its surroundings', 'Chameleons and army uniforms are known for it'],
  ['ALGORITHM', 'Technology', 'A step-by-step set of rules for solving a problem', 'Computers follow these to perform tasks', 'Social media feeds use one to decide what you see'],
  ['BANDWIDTH', 'Technology', 'A measure of capacity', 'The maximum rate at which a network can transfer data', 'At work it also means having time for more tasks: "I don’t have the ___"'],
  ['CRYPTOCURRENCY', 'Technology', 'A form of digital money', 'It is secured with cryptography and usually runs on a blockchain', 'Bitcoin and Ethereum are examples'],
  ['SUSTAINABILITY', 'Environment', 'Meeting today’s needs without harming future generations', 'Companies report on it alongside their ESG goals', 'Solar power and recycling support it'],
  ['CHOREOGRAPHY', 'Arts', 'An art form built on movement', 'The design of sequences of steps and movements', 'Film dance directors get credited for it'],
  ['KALEIDOSCOPE', 'Objects', 'A toy you look into', 'It uses mirrors and pieces of coloured glass', 'Turning it creates ever-changing symmetrical patterns'],
];

const buildDefaults = () =>
  DEFAULT_WORDS.map(([word, category, ...hints]) => ({
    id: crypto.randomBytes(8).toString('hex'),
    word,
    category,
    hints,
    accept: [],
    reveal: autoReveal(word),
  }));

module.exports = { cleanWord, normalize, letterIdx, autoReveal, buildDefaults };
