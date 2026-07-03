#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'node:readline';
import { resolve } from 'node:path';
import { Recorder } from './recorder.js';
import { exportSession } from './exporter.js';

const program = new Command().name('wtf').description('Record web flows, export to Figma');

program
  .command('record')
  .requiredOption('--url <url>', 'start URL')
  .option('--out <dir>', 'session output directory')
  .option('--profile <dir>', 'persistent browser profile dir (keeps logins)')
  .option('--viewport <size>', 'viewport WxH', '1440x900')
  .option('--interactive', 'capture pages as editable Figma layers (DOM) instead of screenshots')
  .action(async (opts: { url: string; out?: string; profile?: string; viewport: string; interactive?: boolean }) => {
    const m = /^(\d+)x(\d+)$/.exec(opts.viewport);
    if (!m) { console.error('invalid --viewport, expected WxH e.g. 1440x900'); process.exit(1); }
    const out = resolve(opts.out ?? `wtf-session-${Date.now()}`);

    const rec = new Recorder({
      url: opts.url,
      out,
      profile: opts.profile,
      viewport: { width: Number(m[1]), height: Number(m[2]) },
      interactive: opts.interactive,
    });

    const finish = async () => {
      await rec.stop();
      rl.close();
      console.log(`\nSession saved to ${out}`);
      console.log(`Next: wtf export ${out}`);
      process.exit(0);
    };

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rec.onClose = () => { void finish(); };
    rec.onDoneRequest = () => { void finish(); };

    await rec.start();
    console.log(`Recording ${opts.url}`);
    console.log(`Session dir: ${out}`);
    console.log('Browse to a page, then click "Capture" in the panel (top-right of the page) to snapshot it.');
    console.log('Only captured pages end up in Figma. Click "Done" there (or type it here) to finish.');
    console.log('Every Capture click is its own snapshot — capture the same page again after opening a modal, tab, etc.');
    console.log('Type a note + Enter to annotate the last captured page.');
    console.log("Command: 'done' = finish.\n");

    rl.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      if (text === 'done') { void finish(); return; }
      rec.note(text);
      console.log('note attached to current page');
    });
    rl.on('SIGINT', () => { void finish(); });
  });

program
  .command('export')
  .argument('<sessionDir>', 'session directory from wtf record')
  .option('--out <file>', 'output bundle', 'figma-import.json')
  .action(async (sessionDir: string, opts: { out: string }) => {
    const outFile = resolve(opts.out);
    await exportSession(resolve(sessionDir), outFile);
    console.log(`Wrote ${outFile} — import it with the wtf Figma plugin.`);
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
