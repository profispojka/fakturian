// Worker thready zacachují Intl zónu při svém vzniku; TZ proto musí být nastavená dřív, v hlavním
// procesu přes globalSetup, ne uvnitř testu ani přes `test.env`.
export function setup() {
	process.env.TZ = 'Europe/Prague';
}
