const TERMS_URL =
  'https://data.edmonton.ca/stories/s/City-of-Edmonton-Open-Data-Terms-of-Use/msh8-if28/'

export default function Footer() {
  return (
    <footer className="px-4 py-4 text-center text-xs text-gray-500">
      <a
        href={TERMS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Contains information licensed under the Open Government Licence – City of Edmonton.
      </a>
    </footer>
  )
}
