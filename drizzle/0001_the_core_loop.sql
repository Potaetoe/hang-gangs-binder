CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`date` text NOT NULL,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entries_member_date` ON `entries` (`member_id`,`date`,`seq`);--> statement-breakpoint
CREATE TABLE `entry_values` (
	`entry_id` text NOT NULL,
	`field_id` text NOT NULL,
	`metric` real,
	`imperial` real,
	`entered` text,
	`choice` text,
	PRIMARY KEY(`entry_id`, `field_id`)
);
--> statement-breakpoint
CREATE INDEX `entry_values_field` ON `entry_values` (`field_id`);--> statement-breakpoint
CREATE TABLE `fields` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`measure` text,
	`computed` text,
	`options` text,
	`position` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`date` text NOT NULL,
	`action` text NOT NULL,
	`entry_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`before` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_audit_member` ON `member_audit` (`member_id`);--> statement-breakpoint
INSERT INTO `fields` (`id`, `name`, `type`, `measure`, `computed`, `options`, `position`, `status`) VALUES
	('height', 'Height', 'number', 'length', NULL, NULL, 1, 'active'),
	('weight', 'Weight', 'number', 'mass', NULL, NULL, 2, 'active'),
	('bmi', 'BMI', 'number', 'plain', 'bmi', NULL, 3, 'active'),
	('gender', 'Gender', 'choice', NULL, NULL, '["Male","Female","Non-binary","Other"]', 4, 'active'),
	('sexuality', 'Sexuality', 'choice', NULL, NULL, '["Straight","Gay","Bisexual","Pansexual","Asexual","Queer","Other"]', 5, 'active'),
	('country', 'Country', 'choice', NULL, NULL, '["Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czechia","DR Congo","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"]', 6, 'active');
