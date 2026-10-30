import { randomInt } from 'node:crypto';

// Translation key names, as Lingo accepts them. Mirrors lingo-server's src/utils/translation-key.ts.

const keyPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

const keyMaxLength = 120;

export function isValidKey(value: string) {
	return value.length <= keyMaxLength && keyPattern.test(value);
}

export const keyRules = `1–${keyMaxLength} letters, numbers, underscores, hyphens, or dots, with no dot at the start, at the end, or next to another`;

const adjectives = [
	'able', 'active', 'agile', 'amber', 'ample', 'bold', 'brave', 'breezy', 'bright', 'brisk',
	'busy', 'calm', 'candid', 'cheery', 'chill', 'civil', 'clean', 'clear', 'clever', 'close',
	'cool', 'cozy', 'crisp', 'curly', 'daring', 'dear', 'deft', 'early', 'easy', 'eager',
	'even', 'exact', 'fair', 'fancy', 'fast', 'few', 'fine', 'firm', 'fluffy', 'fond',
	'free', 'fresh', 'frosty', 'full', 'fuzzy', 'gentle', 'glad', 'golden', 'good', 'grand',
	'great', 'green', 'happy', 'hardy', 'honest', 'humble', 'jolly', 'just', 'keen', 'kind',
	'large', 'lazy', 'level', 'light', 'lively', 'lofty', 'loud', 'lucky', 'mellow', 'merry',
	'mild', 'misty', 'modern', 'neat', 'nice', 'nimble', 'noble', 'novel', 'odd', 'plain',
	'polite', 'proud', 'quick', 'quiet', 'rapid', 'ready', 'real', 'rich', 'round', 'royal',
	'rustic', 'safe', 'shiny', 'short', 'silent', 'silly', 'simple', 'sleek', 'slim', 'smart',
	'smooth', 'snug', 'soft', 'solid', 'sound', 'spicy', 'steady', 'still', 'stout', 'sunny',
	'super', 'sweet', 'swift', 'tall', 'tame', 'tidy', 'tiny', 'true', 'vivid', 'warm',
	'wavy', 'wide', 'wild', 'wise', 'witty', 'young', 'zany', 'zesty'
];

const nouns = [
	'ant', 'ape', 'badger', 'bat', 'bear', 'beaver', 'bee', 'bird', 'bison', 'boar',
	'bobcat', 'bull', 'camel', 'carp', 'cat', 'cheetah', 'chick', 'clam', 'cobra', 'cod',
	'crab', 'crane', 'crow', 'deer', 'dingo', 'dog', 'dolphin', 'dove', 'duck', 'eagle',
	'eel', 'elk', 'emu', 'falcon', 'ferret', 'finch', 'fish', 'fly', 'fox', 'frog',
	'gecko', 'goat', 'goose', 'gull', 'hare', 'hawk', 'hen', 'heron', 'horse', 'hound',
	'ibis', 'jackal', 'jay', 'kitten', 'koala', 'lamb', 'lark', 'lemur', 'lion', 'lizard',
	'llama', 'lynx', 'mole', 'moose', 'moth', 'mouse', 'mule', 'newt', 'otter', 'owl',
	'panda', 'parrot', 'pig', 'pony', 'puffin', 'pug', 'puma', 'quail', 'rabbit', 'ram',
	'raven', 'robin', 'seal', 'shark', 'sheep', 'shrimp', 'skunk', 'slug', 'snail', 'snake',
	'sparrow', 'squid', 'stork', 'swan', 'tapir', 'tiger', 'toad', 'trout', 'tuna', 'turkey',
	'turtle', 'vole', 'walrus', 'wasp', 'whale', 'wolf', 'wombat', 'worm', 'yak', 'zebra'
];

const verbs = [
	'ask', 'bake', 'beam', 'blink', 'bloom', 'boost', 'bounce', 'build', 'burst', 'catch',
	'chase', 'cheer', 'climb', 'clap', 'cook', 'crawl', 'dance', 'dash', 'dig', 'dive',
	'draw', 'dream', 'drift', 'drink', 'drive', 'eat', 'fetch', 'find', 'fly', 'gaze',
	'glide', 'glow', 'grin', 'grow', 'hike', 'hop', 'hug', 'hum', 'hunt', 'jog',
	'jump', 'kick', 'laugh', 'leap', 'learn', 'lift', 'listen', 'march', 'mix', 'nap',
	'nod', 'paint', 'peek', 'play', 'pop', 'race', 'read', 'relax', 'rest', 'ride',
	'roam', 'roar', 'roll', 'run', 'sail', 'sing', 'skip', 'sleep', 'slide', 'smile',
	'sniff', 'snooze', 'spin', 'splash', 'sprint', 'stand', 'stretch', 'surf', 'swim', 'swing',
	'talk', 'think', 'trot', 'twirl', 'type', 'walk', 'wander', 'wave', 'wink', 'yawn'
];

function pick(words: string[]) {
	return words[randomInt(words.length)]!;
}

/**
 * A random key that reads as a phrase, like `brave_otter_jump`, as the Sherlock VS Code extension
 * names new messages: easy to say, to search for, and to tell apart in code. One of over a million.
 */
export function randomKey() {
	return `${pick(adjectives)}_${pick(nouns)}_${pick(verbs)}`;
}
