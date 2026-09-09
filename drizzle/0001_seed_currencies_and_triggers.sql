INSERT INTO "currencies" ("code", "decimals", "name_sv") VALUES
	('SEK', 2, 'Svenska kronor'),
	('EUR', 2, 'Euro'),
	('USD', 2, 'US-dollar'),
	('GBP', 2, 'Brittiska pund'),
	('NOK', 2, 'Norska kronor'),
	('DKK', 2, 'Danska kronor'),
	('JPY', 0, 'Japanska yen'),
	('CHF', 2, 'Schweiziska franc'),
	('PLN', 2, 'Polska zloty'),
	('CZK', 2, 'Tjeckiska koronor'),
	('HUF', 2, 'Ungerska forinter'),
	('THB', 2, 'Thailändska baht'),
	('AUD', 2, 'Australiensiska dollar'),
	('CAD', 2, 'Kanadensiska dollar'),
	('NZD', 2, 'Nyzeeländska dollar'),
	('KRW', 0, 'Sydkoreanska won'),
	('VND', 0, 'Vietnamesiska dong'),
	('ISK', 0, 'Isländska kronor'),
	('KWD', 3, 'Kuwaitiska dinarer'),
	('BHD', 3, 'Bahrainska dinarer'),
	('TND', 3, 'Tunisiska dinarer'),
	('IDR', 2, 'Indonesiska rupier'),
	('INR', 2, 'Indiska rupier'),
	('TRY', 2, 'Turkiska lira'),
	('MXN', 2, 'Mexikanska pesos'),
	('BRL', 2, 'Brasilianska real'),
	('ZAR', 2, 'Sydafrikanska rand'),
	('CNY', 2, 'Kinesiska yuan'),
	('HKD', 2, 'Hongkongdollar'),
	('SGD', 2, 'Singaporianska dollar')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_expense_shares_balance() RETURNS trigger AS $$
DECLARE
	affected_expense_id bigint;
	expected_amount bigint;
	actual_amount bigint;
	share_count integer;
BEGIN
	IF TG_OP = 'DELETE' THEN
		affected_expense_id := OLD.expense_id;
	ELSE
		affected_expense_id := NEW.expense_id;
	END IF;

	SELECT base_amount_minor INTO expected_amount FROM expenses WHERE id = affected_expense_id;

	-- The expense itself may have been deleted in the same transaction (cascade); nothing to check.
	IF expected_amount IS NULL THEN
		RETURN NULL;
	END IF;

	SELECT coalesce(sum(share_base_minor), 0), count(*)
		INTO actual_amount, share_count
		FROM expense_participants
		WHERE expense_id = affected_expense_id;

	IF share_count < 1 THEN
		RAISE EXCEPTION 'expense % must have at least one participant share', affected_expense_id;
	END IF;

	IF actual_amount <> expected_amount THEN
		RAISE EXCEPTION 'expense % participant shares sum to % but base_amount_minor is %',
			affected_expense_id, actual_amount, expected_amount;
	END IF;

	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_expense_shares_balance_for_expense() RETURNS trigger AS $$
DECLARE
	expected_amount bigint;
	actual_amount bigint;
	share_count integer;
BEGIN
	expected_amount := NEW.base_amount_minor;

	SELECT coalesce(sum(share_base_minor), 0), count(*)
		INTO actual_amount, share_count
		FROM expense_participants
		WHERE expense_id = NEW.id;

	IF share_count < 1 THEN
		RAISE EXCEPTION 'expense % must have at least one participant share', NEW.id;
	END IF;

	IF actual_amount <> expected_amount THEN
		RAISE EXCEPTION 'expense % participant shares sum to % but base_amount_minor is %',
			NEW.id, actual_amount, expected_amount;
	END IF;

	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_participants_balance_trigger
	AFTER INSERT OR UPDATE OR DELETE ON expense_participants
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION assert_expense_shares_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expenses_balance_trigger
	AFTER INSERT OR UPDATE ON expenses
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW
	EXECUTE FUNCTION assert_expense_shares_balance_for_expense();
