'use strict';
const {validateUiBundle}=require('../lib/ui-bundle');
const result=validateUiBundle();
process.stdout.write('Verified modular UI bundle: '+result.files+' source files / '+result.size+' characters\n');
