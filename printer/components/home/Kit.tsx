import React from 'react';

/**
 * The brand kit on the public pages. Every shape and doodle is the kit's own
 * file (lobby/shared/brand/, the catalog's art), imported at build time from
 * its one copy, so nothing here is redrawn or copied and a kit change reaches
 * the page by itself. Each paints in currentColor.
 *
 * The club marks are imported as URLs (Vite fingerprints them into /assets/).
 * Awana® and the club marks are trademarks of Awana Clubs International, used
 * by a member church with the disclaimer in the header, the footer and the
 * meta description (owner, 2026-10-11).
 */
import awanaWhite from '../../../lobby/shared/brand/logos/awana-clubs-white.svg';
import pugglesColor from '../../../lobby/shared/brand/logos/puggles-color.svg';
import cubbiesColor from '../../../lobby/shared/brand/logos/cubbies-color.svg';
import sparksColor from '../../../lobby/shared/brand/logos/sparks-color.svg';
import tntColor from '../../../lobby/shared/brand/logos/tnt-color.svg';
import trekColor from '../../../lobby/shared/brand/logos/trek-color.svg';
import journeyColor from '../../../lobby/shared/brand/logos/journey-color.svg';
import pugglesWhite from '../../../lobby/shared/brand/logos/puggles-white.svg';
import cubbiesWhite from '../../../lobby/shared/brand/logos/cubbies-white.svg';
import sparksWhite from '../../../lobby/shared/brand/logos/sparks-white.svg';
import tntWhite from '../../../lobby/shared/brand/logos/tnt-white.svg';
import trekWhite from '../../../lobby/shared/brand/logos/trek-white.svg';
import journeyWhite from '../../../lobby/shared/brand/logos/journey-white.svg';
import pugglesBlack from '../../../lobby/shared/brand/logos/puggles-black.svg';
import cubbiesBlack from '../../../lobby/shared/brand/logos/cubbies-black.svg';
import sparksBlack from '../../../lobby/shared/brand/logos/sparks-black.svg';
import tntBlack from '../../../lobby/shared/brand/logos/tnt-black.svg';
import trekBlack from '../../../lobby/shared/brand/logos/trek-black.svg';
import journeyBlack from '../../../lobby/shared/brand/logos/journey-black.svg';

const doodleFiles = import.meta.glob<string>('../../../lobby/shared/brand/doodles/*.svg', { query: '?raw', import: 'default', eager: true });
const shapeFiles = import.meta.glob<string>('../../../lobby/shared/brand/shapes/*.svg', { query: '?raw', import: 'default', eager: true });

interface Art { viewBox: string; inner: string }
const parse = (raw: string): Art => ({
  viewBox: (raw.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 10 10',
  inner: raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''),
});
const byName = (files: Record<string, string>) => Object.fromEntries(
  Object.entries(files).map(([file, raw]) => [file.replace(/^.*\/([^/]+)\.svg$/, '$1'), parse(raw)]),
);
const DOODLES = byName(doodleFiles);
const SHAPES = byName(shapeFiles);

export type DoodleName =
  | 'check' | 'chevron' | 'coil-line' | 'coil-spiral' | 'coil-spring' | 'dash' | 'dot' | 'hook-arrow' | 'loop-stem'
  | 'loop' | 'pixel-heart' | 'ring' | 'smile-arc' | 'sparkle-4pt-x' | 'sparkle-4pt' | 'squiggle-long' | 'squiggle-s'
  | 'squiggle-wave' | 'steps-block' | 'zigzag-steps' | 'zigzag';
export type ShapeName =
  | 'chip-keyline' | 'chip-plate' | 'corner-blob-trek' | 'starburst' | 'tab-a-cubbies' | 'tab-awards' | 'tab-b-sparks'
  | 'tab-c-journey' | 'tip-blob' | 'wave-sparks' | 'wave-tnt' | 'wave-journey' | 'wave-cubbies' | 'wave-trek' | 'wave-puggles';

const Svg: React.FC<{ art: Art | undefined; className?: string; style?: React.CSSProperties; preserve?: string }> = ({ art, className, style, preserve }) =>
  art ? (
    <svg className={className} style={style} viewBox={art.viewBox} preserveAspectRatio={preserve} aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: art.inner }} />
  ) : null;

/** One kit doodle, placed by its class (position, size, colour). */
export const Doodle: React.FC<{ name: DoodleName; className?: string; style?: React.CSSProperties }> = ({ name, className = '', style }) => (
  <Svg art={DOODLES[name]} className={`kv-doodle ${className}`} style={style} />
);

/** One kit shape. Waves stretch to their box (`stretch`); everything else keeps its proportions. */
export const Shape: React.FC<{ name: ShapeName; className?: string; style?: React.CSSProperties; stretch?: boolean }> = ({ name, className, style, stretch }) => (
  <Svg art={SHAPES[name]} className={className} style={style} preserve={stretch ? 'none' : undefined} />
);

/**
 * The catalog's stepped two-tier chip ("GRADES / K-2"): a small label over a
 * big value, the lower tier stepped right. Drawn in CSS around its text, so it
 * fits any words.
 */
export const StepChip: React.FC<{ label: string; value: string; className?: string; as?: 'span' | 'div' }> = ({ label, value, className = '', as = 'span' }) => {
  const Tag = as;
  return (
    <Tag className={`kv-step ${className}`}>
      <span className="kv-step__label">{label}</span>
      <span className="kv-step__value">{value}</span>
    </Tag>
  );
};

/** The kit's starburst sticker with words on it (the catalog's NEW! stamp). */
export const Sticker: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`kv-sticker ${className}`}>
    <Shape name="starburst" className="kv-sticker__burst" />
    <span className="kv-sticker__text">{children}</span>
  </span>
);

export type ClubId = 'puggles' | 'cubbies' | 'sparks' | 'tnt' | 'trek' | 'journey';

export interface Club { id: ClubId; name: string; ages: string; color: string; white: string; black: string }

/**
 * The six clubs, youngest first: each one's colour mark (on light fields),
 * white mark (on its own club colour, as the lobby TV shows it) and one-colour
 * black mark (as the thermal label prints it). Images load only when shown.
 */
export const CLUBS: Club[] = [
  { id: 'puggles', name: 'Puggles', ages: 'Ages 2 to 3', color: pugglesColor, white: pugglesWhite, black: pugglesBlack },
  { id: 'cubbies', name: 'Cubbies', ages: 'Ages 3 to 5', color: cubbiesColor, white: cubbiesWhite, black: cubbiesBlack },
  { id: 'sparks', name: 'Sparks', ages: 'Grades K to 2', color: sparksColor, white: sparksWhite, black: sparksBlack },
  { id: 'tnt', name: 'T&T', ages: 'Grades 3 to 6', color: tntColor, white: tntWhite, black: tntBlack },
  { id: 'trek', name: 'Trek', ages: 'Grades 6 to 8', color: trekColor, white: trekWhite, black: trekBlack },
  { id: 'journey', name: 'Journey', ages: 'Grades 9 to 12', color: journeyColor, white: journeyWhite, black: journeyBlack },
];

/** A club by the name a roster uses ("T&T", "Sparks"…); Sparks when unknown. */
export const clubByName = (name: string): Club =>
  CLUBS.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) || CLUBS[2];

export const AWANA_WHITE = awanaWhite;
