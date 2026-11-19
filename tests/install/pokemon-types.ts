import {
  createPokemonClient,
  type PokemonResult,
  type PokemonBootstrapResult,
  type PokemonTransport,
} from "tsdm-sdk";
declare const transport: PokemonTransport;
const client = createPokemonClient({
  origin: "https://forum.test",
  session: () => ({ memberId: "31", continuity: "typed-consumer" }),
  transport,
});
const session: Promise<PokemonBootstrapResult> = client.bootstrap();
const profile: Promise<PokemonResult<{ uid: number }>> = client.getProfile();
const write: Promise<PokemonResult<void>> = client.rename(7, "Blue");
void [session, profile, write];
