import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>RentDekho.in</h1>
      <p>
        A hyperlocal rental marketplace, starting in Bhilwara, Rajasthan, India.
      </p>
      <p>We are getting started. The marketplace is under development.</p>
      <p>
        <Link href="/sign-in">Sign in</Link> or{" "}
        <Link href="/sign-up">create an account</Link>.
      </p>
    </main>
  );
}
