import { describe, it, expect } from 'vitest';
import { parseLrc, LrcLine } from './lrc';

describe('parseLrc', () => {
  describe('empty and null inputs', () => {
    it('should return empty array for null input', () => {
      const result = parseLrc(null);
      expect(result).toEqual([]);
    });

    it('should return empty array for undefined input', () => {
      const result = parseLrc(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      const result = parseLrc('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace only', () => {
      const result = parseLrc('   \n\n  \t  ');
      expect(result).toEqual([]);
    });
  });

  describe('single line parsing', () => {
    it('should parse a single lyric line', () => {
      const lrc = '[00:12.34]First lyric line';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 12.34,
        text: 'First lyric line',
      });
    });

    it('should handle leading/trailing whitespace in line', () => {
      const lrc = '  [00:12.34]  Lyric text  ';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 12.34,
        text: '  Lyric text', // Line is trimmed before parsing
      });
    });

    it('should parse at 00:00.00', () => {
      const lrc = '[00:00.00]Start';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 0,
        text: 'Start',
      });
    });
  });

  describe('multiple lines', () => {
    it('should parse multiple lines in order', () => {
      const lrc = `[00:12.34]First lyric line
[01:05.00]Second lyric line
[02:30.50]Third lyric line`;

      const result = parseLrc(lrc);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ time: 12.34, text: 'First lyric line' });
      expect(result[1]).toEqual({ time: 65.0, text: 'Second lyric line' });
      expect(result[2]).toEqual({ time: 150.5, text: 'Third lyric line' });
    });

    it('should sort lines by time if provided out of order', () => {
      const lrc = `[02:30.50]Third lyric line
[00:12.34]First lyric line
[01:05.00]Second lyric line`;

      const result = parseLrc(lrc);

      expect(result).toHaveLength(3);
      expect(result[0].time).toBe(12.34);
      expect(result[1].time).toBe(65.0);
      expect(result[2].time).toBe(150.5);
    });
  });

  describe('word-level timestamp handling', () => {
    it('should strip word-level timestamps from text', () => {
      const lrc = '[00:12.34]<00:12.34>Word1 <00:12.78>Word2';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 12.34,
        text: 'Word1 Word2',
      });
    });

    it('should handle multiple word-level timestamps', () => {
      const lrc = '[00:00.50]<00:00.50>Hello <00:01.20>beautiful <00:02.00>world';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 0.5,
        text: 'Hello beautiful world',
      });
    });

    it('should strip word-level timestamps with various formats', () => {
      const lrc = '[00:05.00]<00:05.00>A <00:05.50>B <00:06.00>C';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 5.0,
        text: 'A B C',
      });
    });
  });

  describe('metadata line handling', () => {
    it('should skip metadata lines like [ti:Title]', () => {
      const lrc = `[ti:Song Title]
[ar:Artist Name]
[00:12.34]First lyric line
[al:Album]
[01:05.00]Second lyric line`;

      const result = parseLrc(lrc);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ time: 12.34, text: 'First lyric line' });
      expect(result[1]).toEqual({ time: 65.0, text: 'Second lyric line' });
    });

    it('should skip lines that do not match timestamp pattern', () => {
      const lrc = `Some random text
[00:10.00]Lyric line
[this is not a timestamp]
[01:20.00]Another lyric`;

      const result = parseLrc(lrc);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ time: 10.0, text: 'Lyric line' });
      expect(result[1]).toEqual({ time: 80.0, text: 'Another lyric' });
    });
  });

  describe('edge cases and time conversion', () => {
    it('should handle large minute values', () => {
      const lrc = '[59:59.99]Last second of hour';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      // 59 * 60 + 59 + 0.99 = 3540 + 59 + 0.99 = 3599.99
      expect(result[0]).toEqual({
        time: 3599.99,
        text: 'Last second of hour',
      });
    });

    it('should correctly convert time: mm * 60 + ss + xx/100', () => {
      // Test case: [01:30.50] should be 1*60 + 30 + 0.50 = 90.50
      const lrc = '[01:30.50]Test time';
      const result = parseLrc(lrc);

      expect(result[0].time).toBe(90.5);
    });

    it('should handle empty text after timestamp', () => {
      const lrc = '[00:10.00]';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ time: 10.0, text: '' });
    });

    it('should handle text with special characters and spaces', () => {
      const lrc = '[00:15.25]  Don\'t you love (it)? [Yes/No]';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 15.25,
        text: '  Don\'t you love (it)? [Yes/No]',
      });
    });

    it('should preserve punctuation and emoji in lyrics', () => {
      const lrc = '[00:20.00]🎵 Music & lyrics! 🎶';
      const result = parseLrc(lrc);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        time: 20.0,
        text: '🎵 Music & lyrics! 🎶',
      });
    });
  });

  describe('loose timestamp formats', () => {
    it('should accept single digit minutes without fraction', () => {
      expect(parseLrc('[1:05]Hello')).toEqual([{ time: 65, text: 'Hello' }]);
    });

    it('should accept one, two and three fraction digits', () => {
      const result = parseLrc(`[00:01.5]a
[00:02.25]b
[00:03.125]c`);
      expect(result.map((l) => l.time)).toEqual([1.5, 2.25, 3.125]);
    });

    it('should accept a colon before hundredths', () => {
      expect(parseLrc('[00:12:34]Colon')).toEqual([{ time: 12.34, text: 'Colon' }]);
    });

    it('should expand multiple timestamps on one line', () => {
      const result = parseLrc(`[00:10.00][01:10.00]Chorus
[00:30.00]Verse`);
      expect(result).toEqual([
        { time: 10, text: 'Chorus' },
        { time: 30, text: 'Verse' },
        { time: 70, text: 'Chorus' },
      ]);
    });

    it('should handle CRLF line endings and Hebrew text', () => {
      const result = parseLrc('[00:01.00]שלום עולם\r\n[00:02.00]שורה שנייה\r\n');
      expect(result).toEqual([
        { time: 1, text: 'שלום עולם' },
        { time: 2, text: 'שורה שנייה' },
      ]);
    });

    it('should still skip metadata such as offset and length tags', () => {
      expect(parseLrc('[offset:+500]\n[length:03:20]\n[00:05.00]Go')).toEqual([{ time: 5, text: 'Go' }]);
    });
  });

  describe('interface compliance', () => {
    it('should return array of LrcLine objects with correct types', () => {
      const lrc = '[00:10.00]Test';
      const result = parseLrc(lrc);

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('time');
      expect(result[0]).toHaveProperty('text');
      expect(typeof result[0].time).toBe('number');
      expect(typeof result[0].text).toBe('string');
    });
  });

  describe('realistic LRC content', () => {
    it('should parse realistic LRCLIB enhanced format with word-level timestamps', () => {
      const lrc = `[ti:Example Song]
[ar:Example Artist]
[al:Example Album]
[00:12.34]<00:12.34>First <00:12.78>lyric <00:13.10>line
[01:05.00]<01:05.00>Second <01:05.50>lyric <01:06.00>line
[02:30.50]<02:30.50>Third <02:31.00>line`;

      const result = parseLrc(lrc);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        time: 12.34,
        text: 'First lyric line',
      });
      expect(result[1]).toEqual({
        time: 65.0,
        text: 'Second lyric line',
      });
      expect(result[2]).toEqual({
        time: 150.5,
        text: 'Third line',
      });
    });

    it('should handle mixed metadata and lyric lines', () => {
      const lrc = `[ti:Beautiful Song]
[ar:Amazing Artist]
[00:00.00]Verse starts
[00:05.50]<00:05.50>Keep <00:06.00>singing
[00:10.00]Chorus begins
[al:Greatest Hits]
[00:20.00]And the beat goes on`;

      const result = parseLrc(lrc);

      expect(result).toHaveLength(4);
      expect(result[0].text).toBe('Verse starts');
      expect(result[1].text).toBe('Keep singing');
      expect(result[2].text).toBe('Chorus begins');
      expect(result[3].text).toBe('And the beat goes on');
    });
  });
});
