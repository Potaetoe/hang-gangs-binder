

globalThis.BINDER_SITE = {

   
   

  group: {
     
     
    name: "Hang Gang",

     
     
     
    binder: "Binder",
  },

   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   

  units: {
     
     
    default: "imperial",
    systems: ["metric", "imperial"],

    kinds: {
      weight: {
         
         
         
        enter: { metric: "kg", imperial: "lb" },
        chart: { metric: "kg", imperial: "lb" },
        base: "kg",
        units: {
          kg: { per: 1, min: 20, max: 500, bin: 10, band: "10 kg bands",
                store: "kg" },
          lb: { per: 0.45359237, min: 44, max: 1100, bin: 20,
                band: "20 lb bands", store: "lb" },
        },
      },

      length: {
         
         
         
         
        enter: { metric: "cm", imperial: "ft" },
        chart: { metric: "cm", imperial: "in" },
        base: "cm",
         
         
        compound: { ft: "in" },
        units: {
          cm: { per: 1, min: 100, max: 250, bin: 5, band: "5 cm bands",
                store: "cm" },
          in: { per: 2.54, bin: 2, band: "2 in bands",
                store: "totalInches" },
          ft: { per: 30.48, min: 3, max: 8 },
        },
      },

       
       
       
      count: {
        base: null,
        units: {},
      },
    },
  },

   
   

  fields: [
    {
      name: "over18",
      kind: "consent",
      label: "I confirm I am 18 or older.",
      term: "age confirmation",
      required: true,
      chart: false,
    },
    {
      name: "weight",
      kind: "weight",
      label: "Weight",
      term: "weight",
      required: true,
      chart: true,
    },
    {
      name: "height",
      kind: "length",
      label: "Height",
      term: "height",
      required: true,
      chart: true,
    },
    {
       
       
       
       
       
      name: "bmi",
      kind: "computed",
      label: "BMI",
      term: "BMI",
      derivation: "bmi",
      from: ["weight", "height"],
       
       
       
       
      unitless: true,
      places: 1,
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
       
      bin: 5,
      min: 0,
      max: 600,
      chart: true,
    },
    {
      name: "gender",
      kind: "choice",
      label: "Gender",
      term: "gender",
       
       
      blank: "Prefer not to say",
      choices: [
        { value: "male", label: "Male" },
        { value: "female", label: "Female" },
        { value: "nonbinary", label: "Non-binary" },
        { value: "other", label: "Other" },
      ],
      chart: true,
    },
    {
      name: "roles",
      kind: "choice",
      multiple: true,
      label: "Feedism affiliations",
       
       
      term: "affiliation",
      choices: [
        { value: "feeder", label: "Feeder" },
        { value: "feedee", label: "Feedee" },
        { value: "gainer", label: "Gainer" },
        { value: "admirer", label: "Fat admirer" },
      ],
      chart: true,
    },
    {
      name: "country",
      kind: "choice",
      label: "Country",
      term: "country",
      blank: "Prefer not to say",
       
       
       
       
      choicesFrom: "countries",
      chart: true,
    },
  ],
};
