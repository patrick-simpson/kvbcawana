import React from 'react';
import { Clubber } from './types';

interface ClubberListProps {
  clubbers: Clubber[];
  onSelect: (clubber: Clubber) => void;
}

// Each row keeps TwoTimTwo's own structure (.clubber > .name + .club img):
// the name in .name and the club in the img's alt. The img carries no src:
// the replica has no club art.
// The tt- classes are the replica's look (styles/home.css); never the contract.
export const ClubberList: React.FC<ClubberListProps> = ({ clubbers, onSelect }) => (
  <div className="tt-grid">
    {clubbers.map((clubber) => (
      <div
        key={clubber.id}
        role="button"
        tabIndex={0}
        aria-label={`${clubber.name}, ${clubber.club}: open check-in`}
        onClick={() => onSelect(clubber)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(clubber); }
        }}
        className={`clubber tt-clubber tt-clubber--${clubber.gender}`}
      >
        <div className="name tt-clubber__name">{clubber.name}</div>
        <div className="club tt-clubber__club">
          <span><img alt={clubber.club} hidden />{clubber.club}</span>
        </div>
        <div className="tt-clubber__color">
          {clubber.color && clubber.color !== '(Unassigned)' ? `Color: ${clubber.color}` : ''}
        </div>
      </div>
    ))}
  </div>
);
