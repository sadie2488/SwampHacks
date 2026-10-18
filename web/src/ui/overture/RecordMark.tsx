/**
 * A mini vinyl record with a star-shaped centre hole (the TouchDesigner switch next to the logo).
 * One even-odd path: the disc, two thin groove rings and the star are all real holes, so the
 * background shows through them. The disc takes the current text colour.
 */
export function RecordMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="record-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d={
          'M12 1a11 11 0 1 0 0 22a11 11 0 1 0 0-22z' +
          'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z' +
          'M12 3.6a8.4 8.4 0 1 0 0 16.8a8.4 8.4 0 1 0 0-16.8z' +
          'M12 5.6a6.4 6.4 0 1 0 0 12.8a6.4 6.4 0 1 0 0-12.8z' +
          'M12 6.2a5.8 5.8 0 1 0 0 11.6a5.8 5.8 0 1 0 0-11.6z' +
          'M12 8.4L12.91 10.75L15.42 10.89L13.47 12.48L14.12 14.91L12 13.55L9.88 14.91L10.53 12.48L8.58 10.89L11.09 10.75z'
        }
      />
    </svg>
  );
}
