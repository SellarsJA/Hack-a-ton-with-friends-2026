import SearchForm from '@/components/SearchForm'

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Edmonton Transit Planner</h1>
      <SearchForm />
    </main>
  )
}
